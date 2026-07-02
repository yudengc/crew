using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Serilog;

namespace Crew.App.Services
{
    public class AiService
    {
        private readonly HttpClient _httpClient;
        private readonly Dictionary<string, CancellationTokenSource> _cancellations = new();
        private static readonly JsonSerializerOptions _jsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        public AiService()
        {
            _httpClient = new HttpClient();
            _httpClient.Timeout = TimeSpan.FromMinutes(5);
        }

        // ── Public API ──────────────────────────────────────────

        /// <summary>Non-streaming chat (backward compatible).</summary>
        public async Task<string> CallAsync(string action, string? data, string settingsJson)
        {
            try
            {
                var settings = JsonSerializer.Deserialize<AppSettings>(settingsJson, _jsonOptions);
                if (settings == null) return Error("无效的设置");

                if (string.IsNullOrEmpty(settings.ClaudeApiKey) && settings.AiProvider == "claude")
                    return Error("请先在设置中配置 Claude API Key");
                if (string.IsNullOrEmpty(settings.OpenAiApiKey) && settings.AiProvider == "openai")
                    return Error("请先在设置中配置 OpenAI API Key");
                if (string.IsNullOrEmpty(settings.DeepSeekApiKey) && settings.AiProvider == "deepseek")
                    return Error("请先在设置中配置 DeepSeek API Key");

                var request = JsonSerializer.Deserialize<AiRequest>(data ?? "{}", _jsonOptions);
                if (request == null) return Error("无效的请求");

                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(3));
                return await ChatOnceAsync(request, settings, cts.Token);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "AI service error");
                return Error(ex.Message);
            }
        }

        /// <summary>Streaming chat — pushes chunks via callback.</summary>
        public async Task StreamChatAsync(
            AiRequest request,
            AppSettings settings,
            Func<string, Task> onChunk,
            CancellationToken cancelToken)
        {
            await ChatStreamingAsync(request, settings, onChunk, cancelToken);
        }

        /// <summary>Agent loop: ReAct pattern with tool calling.</summary>
        public async Task<string> RunAgentLoopAsync(
            AgentLoopRequest loopRequest,
            AppSettings settings,
            Func<string, string, Task>? onProgress,
            CancellationToken cancelToken)
        {
            var tools = ToolRegistry.GetStandardTools();
            var messages = new List<ConversationMessage>();

            // System prompt
            messages.Add(new ConversationMessage
            {
                Role = "system",
                Content = BuildAgentSystemPrompt(loopRequest)
            });

            // Task prompt
            messages.Add(new ConversationMessage
            {
                Role = "user",
                Content = loopRequest.Task
            });

            var iteration = 0;
            var maxIterations = loopRequest.MaxIterations > 0 ? loopRequest.MaxIterations : 15;
            var finalResult = "";

            while (iteration < maxIterations)
            {
                cancelToken.ThrowIfCancellationRequested();
                iteration++;

                if (onProgress != null)
                    await onProgress("thinking", $"第 {iteration} 轮思考中...");

                Log.Debug("[AGENT_LOOP] {Agent} iteration {Iter}/{Max} with {MsgCount} messages",
                    loopRequest.AgentName, iteration, maxIterations, messages.Count);

                // Build the API request with conversation history
                var aiRequest = new AiRequest
                {
                    Messages = messages.ToList(),
                    ModelId = loopRequest.ModelId ?? settings.DefaultModel,
                    Temperature = loopRequest.Temperature ?? 0.7,
                    MaxTokens = loopRequest.MaxTokens ?? 4096,
                    Tools = tools
                };

                string rawResponse;
                try
                {
                    rawResponse = await ChatOnceWithRetryAsync(aiRequest, settings, cancelToken);
                }
                catch (OperationCanceledException)
                {
                    return Error("任务已取消");
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Agent loop iteration {Iteration} failed", iteration);
                    return Error($"Agent 执行出错 (第 {iteration} 轮): {ex.Message}");
                }

                // Parse response for tool calls
                var (assistantText, toolCalls) = ParseResponse(rawResponse, settings.AiProvider);

                // If response is empty and no tools, the API may have returned an error
                if (string.IsNullOrEmpty(assistantText) && toolCalls.Count == 0)
                {
                    // Check if this was an API error by re-reading the raw response
                    try
                    {
                        using var checkDoc = JsonDocument.Parse(rawResponse);
                        var apiErr = DetectApiError(checkDoc.RootElement, settings.AiProvider);
                        if (apiErr != null)
                            return Error($"API 错误: {apiErr}");
                    }
                    catch { /* fall through to retry */ }

                    // Not an API error — maybe empty response, retry if iterations remain
                    if (iteration < maxIterations - 1) continue;
                    finalResult = "未能获取有效回复";
                    break;
                }

                if (toolCalls.Count > 0)
                {
                    // Add assistant message with tool calls
                    messages.Add(new ConversationMessage
                    {
                        Role = "assistant",
                        Content = assistantText,
                        ToolCalls = toolCalls
                    });

                    // Execute each tool and add results
                    foreach (var tc in toolCalls)
                    {
                        cancelToken.ThrowIfCancellationRequested();

                        if (onProgress != null)
                            await onProgress("tool", $"执行工具: {tc.Name}");

                        var toolResult = await ToolRegistry.ExecuteAsync(tc.Name, tc.Arguments, cancelToken);

                        messages.Add(new ConversationMessage
                        {
                            Role = "user",
                            Content = $"[工具结果 id={tc.Id}] {tc.Name}({JsonSerializer.Serialize(tc.Arguments)}):\n{toolResult}"
                        });

                        if (onProgress != null)
                            await onProgress("tool_result", $"工具 {tc.Name} 完成");
                    }

                    // Continue loop — the AI will process tool results
                    continue;
                }

                // No tool calls — agent is done
                finalResult = assistantText;
                messages.Add(new ConversationMessage
                {
                    Role = "assistant",
                    Content = assistantText
                });
                break;
            }

            if (iteration >= maxIterations && string.IsNullOrEmpty(finalResult))
            {
                // Force a summary from the last state
                messages.Add(new ConversationMessage
                {
                    Role = "user",
                    Content = "请基于以上所有工具执行结果，给出最终答案。用中文回答。"
                });

                var finalRequest = new AiRequest
                {
                    Messages = messages.ToList(),
                    ModelId = loopRequest.ModelId ?? settings.DefaultModel,
                    Temperature = 0.5,
                    MaxTokens = 4096
                };

                try
                {
                    var forcedResponse = await ChatOnceWithRetryAsync(finalRequest, settings, cancelToken);
                    var (forcedText, _) = ParseResponse(forcedResponse, settings.AiProvider);
                    finalResult = forcedText;
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Final summary failed");
                    finalResult = $"达到最大迭代次数 ({maxIterations})，无法完成任务。";
                }
            }

            return JsonSerializer.Serialize(new { result = finalResult, iterations = iteration });
        }

        /// <summary>Register a cancellable stream.</summary>
        public void RegisterCancellation(string streamId, CancellationTokenSource cts)
        {
            lock (_cancellations)
            {
                _cancellations[streamId] = cts;
            }
        }

        /// <summary>Remove a cancellation registration (cleanup after completion).</summary>
        public void UnregisterCancellation(string streamId)
        {
            lock (_cancellations)
            {
                _cancellations.Remove(streamId);
            }
        }

        /// <summary>Cancel a running stream by ID.</summary>
        public void CancelStream(string streamId)
        {
            lock (_cancellations)
            {
                if (_cancellations.TryGetValue(streamId, out var cts))
                {
                    cts.Cancel();
                    _cancellations.Remove(streamId);
                    Log.Information("Cancelled stream {StreamId}", streamId);
                }
            }
        }

        // ── Core chat (single turn, non-streaming, with retry) ───

        private async Task<string> ChatOnceAsync(AiRequest request, AppSettings settings, CancellationToken cancelToken)
        {
            return settings.AiProvider switch
            {
                "claude" => await CallClaudeOnceAsync(request, settings.ClaudeApiKey, cancelToken),
                "openai" => await CallOpenAiOnceAsync(request, settings.OpenAiApiKey, cancelToken),
                "deepseek" => await CallDeepSeekOnceAsync(request, settings.DeepSeekApiKey, cancelToken),
                _ => Error("不支持的 AI 提供商")
            };
        }

        private async Task<string> ChatOnceWithRetryAsync(AiRequest request, AppSettings settings, CancellationToken cancelToken)
        {
            return await RetryWithBackoffAsync(
                () => ChatOnceAsync(request, settings, cancelToken),
                cancelToken);
        }

        // ── Streaming implementation ─────────────────────────────

        private async Task ChatStreamingAsync(
            AiRequest request,
            AppSettings settings,
            Func<string, Task> onChunk,
            CancellationToken cancelToken)
        {
            var provider = settings.AiProvider;
            var apiKey = provider switch
            {
                "claude" => settings.ClaudeApiKey,
                "openai" => settings.OpenAiApiKey,
                "deepseek" => settings.DeepSeekApiKey,
                _ => throw new ArgumentException($"不支持的提供商: {provider}")
            };

            if (string.IsNullOrEmpty(apiKey))
                throw new ArgumentException("未配置 API Key");

            var (url, payload, headers) = provider switch
            {
                "claude" => BuildClaudeStreamRequest(request, apiKey),
                "openai" => BuildOpenAiStreamRequest(request, apiKey),
                "deepseek" => BuildDeepSeekStreamRequest(request, apiKey),
                _ => throw new ArgumentException($"不支持的提供商: {provider}")
            };

            // Streaming: send HTTP request (retry once on transient connection error)
            var httpRequest = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            foreach (var (key, value) in headers)
                httpRequest.Headers.Add(key, value);

            HttpResponseMessage response;
            try
            {
                response = await _httpClient.SendAsync(httpRequest,
                    HttpCompletionOption.ResponseHeadersRead, cancelToken);
            }
            catch (HttpRequestException)
            {
                // One retry for transient network errors before streaming begins
                response = await _httpClient.SendAsync(httpRequest,
                    HttpCompletionOption.ResponseHeadersRead, cancelToken);
            }

            using (response)
            {
                response.EnsureSuccessStatusCode();

                using var stream = await response.Content.ReadAsStreamAsync();
                using var reader = new StreamReader(stream);

                if (provider == "claude")
                {
                    await ReadClaudeSseAsync(reader, onChunk, cancelToken);
                }
                else
                {
                    await ReadOpenAiSseAsync(reader, onChunk, cancelToken);
                }
            }
        }

        private async Task ReadClaudeSseAsync(StreamReader reader, Func<string, Task> onChunk, CancellationToken cancelToken)
        {
            string? currentEvent = null;
            while (!reader.EndOfStream)
            {
                cancelToken.ThrowIfCancellationRequested();
                var line = await reader.ReadLineAsync();

                if (string.IsNullOrEmpty(line)) continue;

                if (line.StartsWith("event: "))
                {
                    currentEvent = line[7..];
                    continue;
                }

                if (line.StartsWith("data: "))
                {
                    var data = line[6..];
                    try
                    {
                        using var doc = JsonDocument.Parse(data);
                        var root = doc.RootElement;

                        if (root.TryGetProperty("type", out var typeProp))
                        {
                            var type = typeProp.GetString();

                            if (type == "content_block_delta")
                            {
                                var delta = root.GetProperty("delta");
                                if (delta.TryGetProperty("type", out var deltaType) && deltaType.GetString() == "text_delta")
                                {
                                    var text = delta.GetProperty("text").GetString();
                                    if (!string.IsNullOrEmpty(text))
                                        await onChunk(text);
                                }
                            }
                            else if (type == "message_stop")
                            {
                                break;
                            }
                        }
                    }
                    catch (JsonException) { /* skip malformed SSE data */ }
                }
            }
        }

        private async Task ReadOpenAiSseAsync(StreamReader reader, Func<string, Task> onChunk, CancellationToken cancelToken)
        {
            while (!reader.EndOfStream)
            {
                cancelToken.ThrowIfCancellationRequested();
                var line = await reader.ReadLineAsync();

                if (string.IsNullOrEmpty(line)) continue;
                if (!line.StartsWith("data: ")) continue;

                var data = line[6..];
                if (data == "[DONE]") break;

                try
                {
                    using var doc = JsonDocument.Parse(data);
                    var choices = doc.RootElement.GetProperty("choices");
                    if (choices.GetArrayLength() > 0)
                    {
                        var delta = choices[0].GetProperty("delta");
                        if (delta.TryGetProperty("content", out var content))
                        {
                            var text = content.GetString();
                            if (!string.IsNullOrEmpty(text))
                                await onChunk(text);
                        }
                    }
                }
                catch (JsonException) { /* skip malformed */ }
            }
        }

        // ── Non-streaming Claude ─────────────────────────────────

        private async Task<string> CallClaudeOnceAsync(AiRequest request, string apiKey, CancellationToken cancelToken)
        {
            var (url, payload, headers) = BuildClaudeNonStreamRequest(request, apiKey);

            var httpRequest = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            foreach (var (key, value) in headers)
                httpRequest.Headers.Add(key, value);

            using var response = await _httpClient.SendAsync(httpRequest, cancelToken);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Log.Warning("Claude API error {Status}: {Body}", (int)response.StatusCode, body);
                throw new ApiException($"Claude API {(int)response.StatusCode}", body, (int)response.StatusCode);
            }

            return body;
        }

        // ── Non-streaming OpenAI ─────────────────────────────────

        private async Task<string> CallOpenAiOnceAsync(AiRequest request, string apiKey, CancellationToken cancelToken)
        {
            var (url, payload, headers) = BuildOpenAiNonStreamRequest(request, apiKey);

            var httpRequest = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            foreach (var (key, value) in headers)
                httpRequest.Headers.Add(key, value);

            using var response = await _httpClient.SendAsync(httpRequest, cancelToken);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Log.Warning("OpenAI API error {Status}: {Body}", (int)response.StatusCode, body);
                throw new ApiException($"OpenAI API {(int)response.StatusCode}", body, (int)response.StatusCode);
            }

            return body;
        }

        // ── DeepSeek (OpenAI-compatible API) ────────────────────

        private async Task<string> CallDeepSeekOnceAsync(AiRequest request, string apiKey, CancellationToken cancelToken)
        {
            var (url, payload, headers) = BuildDeepSeekNonStreamRequest(request, apiKey);

            var httpRequest = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            foreach (var (key, value) in headers)
                httpRequest.Headers.Add(key, value);

            using var response = await _httpClient.SendAsync(httpRequest, cancelToken);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Log.Warning("DeepSeek API error {Status}: {Body}", (int)response.StatusCode, body);
                throw new ApiException($"DeepSeek API {(int)response.StatusCode}", body, (int)response.StatusCode);
            }

            return body;
        }

        private static (string url, string payload, (string, string)[] headers) BuildDeepSeekNonStreamRequest(AiRequest request, string apiKey)
        {
            var messages = BuildOpenAiMessages(request);
            var body = new Dictionary<string, object>
            {
                ["model"] = request.ModelId ?? "deepseek-chat",
                ["max_tokens"] = request.MaxTokens ?? 4096,
                ["temperature"] = request.Temperature ?? 0.7,
                ["messages"] = messages
            };

            if (request.Tools != null && request.Tools.Count > 0)
            {
                body["tools"] = ConvertToolsForOpenAi(request.Tools);
            }

            var headers = new (string, string)[]
            {
                ("Authorization", $"Bearer {apiKey}")
            };

            return (
                "https://api.deepseek.com/v1/chat/completions",
                JsonSerializer.Serialize(body),
                headers
            );
        }

        private static (string url, string payload, (string, string)[] headers) BuildDeepSeekStreamRequest(AiRequest request, string apiKey)
        {
            var (url, basePayload, headers) = BuildDeepSeekNonStreamRequest(request, apiKey);
            var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(basePayload)!;
            dict["stream"] = true;
            return (url, JsonSerializer.Serialize(dict), headers);
        }

        // ── Retry logic ──────────────────────────────────────────

        private async Task<string> RetryWithBackoffAsync(
            Func<Task<string>> action,
            CancellationToken cancelToken,
            int maxRetries = 3)
        {
            var delay = TimeSpan.FromSeconds(1);
            for (int attempt = 0; attempt <= maxRetries; attempt++)
            {
                try
                {
                    return await action();
                }
                catch (ApiException ex) when (IsRetryable(ex.StatusCode))
                {
                    if (attempt == maxRetries) throw;
                    Log.Warning("Retry {Attempt}/{Max} after {Delay}s: {Status}",
                        attempt + 1, maxRetries, delay.TotalSeconds, ex.StatusCode);
                    await Task.Delay(delay, cancelToken);
                    delay *= 2; // exponential backoff: 1s → 2s → 4s → 8s
                }
                catch (HttpRequestException) when (attempt < maxRetries)
                {
                    Log.Warning("Network error, retry {Attempt}/{Max}", attempt + 1, maxRetries);
                    await Task.Delay(delay, cancelToken);
                    delay *= 2;
                }
                catch (TaskCanceledException) when (attempt < maxRetries && !cancelToken.IsCancellationRequested)
                {
                    Log.Warning("Timeout, retry {Attempt}/{Max}", attempt + 1, maxRetries);
                    await Task.Delay(delay, cancelToken);
                    delay *= 2;
                }
            }
            throw new InvalidOperationException("Unreachable retry loop");
        }

        private static bool IsRetryable(int statusCode) =>
            statusCode == 429 || statusCode >= 500;

        // ── Request builders ─────────────────────────────────────

        private static (string url, string payload, (string, string)[] headers) BuildClaudeNonStreamRequest(AiRequest request, string apiKey)
        {
            var (systemPrompt, messages) = BuildClaudeMessagesWithSystem(request);
            var body = new Dictionary<string, object>
            {
                ["model"] = request.ModelId ?? "claude-sonnet-4-20250514",
                ["max_tokens"] = request.MaxTokens ?? 4096,
                ["temperature"] = request.Temperature ?? 0.7,
                ["messages"] = messages
            };

            // Add system prompt as top-level field (Claude API requirement)
            if (!string.IsNullOrEmpty(systemPrompt))
            {
                body["system"] = systemPrompt;
            }

            // Add tools if provided
            if (request.Tools != null && request.Tools.Count > 0)
            {
                body["tools"] = ConvertToolsForClaude(request.Tools);
            }

            var headers = new (string, string)[]
            {
                ("x-api-key", apiKey),
                ("anthropic-version", "2023-06-01")
            };

            return (
                "https://api.anthropic.com/v1/messages",
                JsonSerializer.Serialize(body),
                headers
            );
        }

        private static (string url, string payload, (string, string)[] headers) BuildClaudeStreamRequest(AiRequest request, string apiKey)
        {
            var (url, basePayload, headers) = BuildClaudeNonStreamRequest(request, apiKey);
            var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(basePayload)!;
            dict["stream"] = true;
            return (url, JsonSerializer.Serialize(dict), headers);
        }

        private static (string url, string payload, (string, string)[] headers) BuildOpenAiNonStreamRequest(AiRequest request, string apiKey)
        {
            var messages = BuildOpenAiMessages(request);
            var body = new Dictionary<string, object>
            {
                ["model"] = request.ModelId ?? "gpt-4",
                ["max_tokens"] = request.MaxTokens ?? 4096,
                ["temperature"] = request.Temperature ?? 0.7,
                ["messages"] = messages
            };

            if (request.Tools != null && request.Tools.Count > 0)
            {
                body["tools"] = ConvertToolsForOpenAi(request.Tools);
            }

            var headers = new (string, string)[]
            {
                ("Authorization", $"Bearer {apiKey}")
            };

            return (
                "https://api.openai.com/v1/chat/completions",
                JsonSerializer.Serialize(body),
                headers
            );
        }

        private static (string url, string payload, (string, string)[] headers) BuildOpenAiStreamRequest(AiRequest request, string apiKey)
        {
            var (url, basePayload, headers) = BuildOpenAiNonStreamRequest(request, apiKey);
            var dict = JsonSerializer.Deserialize<Dictionary<string, object>>(basePayload)!;
            dict["stream"] = true;
            return (url, JsonSerializer.Serialize(dict), headers);
        }

        // ── Message builders ─────────────────────────────────────

        /// <summary>Returns (systemPrompt, userMessages). System is separate for Claude's top-level field.</summary>
        private static (string? system, object[] messages) BuildClaudeMessagesWithSystem(AiRequest request)
        {
            var messages = new List<object>();
            string? systemPrompt = null;

            if (request.Messages != null && request.Messages.Count > 0)
            {
                foreach (var msg in request.Messages)
                {
                    if (msg.Role == "system")
                    {
                        // Collect system prompt for top-level field
                        systemPrompt = (systemPrompt != null)
                            ? systemPrompt + "\n\n" + msg.Content
                            : msg.Content;
                    }
                    else if (msg.Role == "assistant" && msg.ToolCalls != null && msg.ToolCalls.Count > 0)
                    {
                        var content = new List<object>();
                        if (!string.IsNullOrEmpty(msg.Content))
                            content.Add(new { type = "text", text = msg.Content });
                        foreach (var tc in msg.ToolCalls)
                        {
                            content.Add(new
                            {
                                type = "tool_use",
                                id = tc.Id,
                                name = tc.Name,
                                input = tc.Arguments ?? new Dictionary<string, object>()
                            });
                        }
                        messages.Add(new { role = "assistant", content = content.ToArray() });
                    }
                    else if (msg.Role == "user" && msg.Content.StartsWith("[工具结果]"))
                    {
                        // Tool result: for Claude, need to map tool_use_id properly
                        var toolResults = ParseToolResults(msg.Content);
                        var content = new List<object>();
                        foreach (var tr in toolResults)
                        {
                            content.Add(new
                            {
                                type = "tool_result",
                                tool_use_id = tr.Id,
                                content = tr.Result
                            });
                        }
                        messages.Add(new { role = "user", content = content.ToArray() });
                    }
                    else
                    {
                        var role = msg.Role switch
                        {
                            "assistant" => "assistant",
                            _ => "user"
                        };
                        messages.Add(new { role, content = msg.Content });
                    }
                }
            }
            else if (!string.IsNullOrEmpty(request.Prompt))
            {
                messages.Add(new { role = "user", content = request.Prompt });
            }

            return (systemPrompt, messages.ToArray());
        }

        private static object[] BuildOpenAiMessages(AiRequest request)
        {
            var messages = new List<object>();

            if (request.Messages != null && request.Messages.Count > 0)
            {
                foreach (var msg in request.Messages)
                {
                    if (msg.Role == "assistant" && msg.ToolCalls != null && msg.ToolCalls.Count > 0)
                    {
                        messages.Add(new
                        {
                            role = "assistant",
                            content = string.IsNullOrEmpty(msg.Content) ? null : msg.Content,
                            tool_calls = msg.ToolCalls.Select(tc => new
                            {
                                id = tc.Id,
                                type = "function",
                                function = new
                                {
                                    name = tc.Name,
                                    arguments = JsonSerializer.Serialize(tc.Arguments ?? new())
                                }
                            }).ToArray()
                        });
                    }
                    else if (msg.Role == "user" && msg.Content.StartsWith("[工具结果"))
                    {
                        // Tool results need role: "tool" + tool_call_id for OpenAI/DeepSeek
                        var toolResults = ParseToolResults(msg.Content);
                        foreach (var tr in toolResults)
                        {
                            messages.Add(new
                            {
                                role = "tool",
                                tool_call_id = tr.Id,
                                content = tr.Result
                            });
                        }
                    }
                    else
                    {
                        messages.Add(new
                        {
                            role = msg.Role == "system" ? "system" : msg.Role,
                            content = msg.Content
                        });
                    }
                }
            }
            else if (!string.IsNullOrEmpty(request.Prompt))
            {
                messages.Add(new { role = "user", content = request.Prompt });
            }

            return messages.ToArray();
        }

        // ── Tool conversion ──────────────────────────────────────

        private static object[] ConvertToolsForClaude(List<ToolDefinition> tools)
        {
            return tools.Select(t => new
            {
                name = t.Name,
                description = t.Description,
                input_schema = new
                {
                    type = "object",
                    properties = t.Parameters ?? new(),
                    required = t.Required ?? Array.Empty<string>()
                }
            }).ToArray();
        }

        private static object[] ConvertToolsForOpenAi(List<ToolDefinition> tools)
        {
            return tools.Select(t => new
            {
                type = "function",
                function = new
                {
                    name = t.Name,
                    description = t.Description,
                    parameters = new
                    {
                        type = "object",
                        properties = t.Parameters ?? new(),
                        required = t.Required ?? Array.Empty<string>()
                    }
                }
            }).ToArray();
        }

        // ── Response parsing ─────────────────────────────────────

        private static (string text, List<AgentToolCall> toolCalls) ParseResponse(string rawResponse, string provider)
        {
            try
            {
                using var doc = JsonDocument.Parse(rawResponse);
                var root = doc.RootElement;

                // Check for API-level error responses first
                var apiError = DetectApiError(root, provider);
                if (apiError != null)
                {
                    Log.Warning("{Provider} API error in response: {Error}", provider, apiError);
                    return ("", new List<AgentToolCall>()); // Will trigger "empty result" handling upstream
                }

                if (provider == "claude")
                {
                    return ParseClaudeContent(root);
                }
                else
                {
                    // OpenAI and DeepSeek share the same response format
                    return ParseOpenAiContent(root);
                }
            }
            catch (JsonException)
            {
                // Raw text response
                return (rawResponse, new List<AgentToolCall>());
            }
        }

        /// <summary>Returns error message if the API response is an error, null otherwise.</summary>
        private static string? DetectApiError(JsonElement root, string provider)
        {
            if (provider == "claude")
            {
                if (root.TryGetProperty("type", out var t) && t.GetString() == "error"
                    && root.TryGetProperty("error", out var err))
                {
                    return err.TryGetProperty("message", out var msg)
                        ? msg.GetString()
                        : err.GetRawText();
                }
            }
            else
            {
                // OpenAI / DeepSeek errors: {"error":{"message":"...","type":"..."}}
                if (root.TryGetProperty("error", out var err))
                {
                    return err.TryGetProperty("message", out var msg)
                        ? msg.GetString()
                        : err.GetRawText();
                }
            }
            return null;
        }

        private static (string text, List<AgentToolCall> toolCalls) ParseClaudeContent(JsonElement root)
        {
            var text = "";
            var toolCalls = new List<AgentToolCall>();

            if (root.TryGetProperty("content", out var content))
            {
                foreach (var block in content.EnumerateArray())
                {
                    var type = block.GetProperty("type").GetString();
                    if (type == "text")
                    {
                        text += block.GetProperty("text").GetString() ?? "";
                    }
                    else if (type == "tool_use")
                    {
                        toolCalls.Add(new AgentToolCall
                        {
                            Id = block.GetProperty("id").GetString() ?? Guid.NewGuid().ToString(),
                            Name = block.GetProperty("name").GetString() ?? "",
                            Arguments = JsonSerializer.Deserialize<Dictionary<string, object>>(
                                block.GetProperty("input").GetRawText()) ?? new()
                        });
                    }
                }
            }

            return (text.Trim(), toolCalls);
        }

        private static (string text, List<AgentToolCall> toolCalls) ParseOpenAiContent(JsonElement root)
        {
            var text = "";
            var toolCalls = new List<AgentToolCall>();

            if (root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
            {
                var message = choices[0].GetProperty("message");
                if (message.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String)
                    text = c.GetString() ?? "";

                if (message.TryGetProperty("tool_calls", out var tc) && tc.ValueKind == JsonValueKind.Array)
                {
                    foreach (var tcItem in tc.EnumerateArray())
                    {
                        var func = tcItem.GetProperty("function");
                        toolCalls.Add(new AgentToolCall
                        {
                            Id = tcItem.GetProperty("id").GetString() ?? Guid.NewGuid().ToString(),
                            Name = func.GetProperty("name").GetString() ?? "",
                            Arguments = JsonSerializer.Deserialize<Dictionary<string, object>>(
                                func.GetProperty("arguments").GetString() ?? "{}") ?? new()
                        });
                    }
                }
            }

            return (text.Trim(), toolCalls);
        }

        // ── Tool result parsing ──────────────────────────────────

        private static List<(string Id, string Result)> ParseToolResults(string content)
        {
            var results = new List<(string, string)>();
            // Parse all "[工具结果 id=xxx] ..." blocks
            var matches = System.Text.RegularExpressions.Regex.Matches(content, @"\[工具结果 id=([^\]]+)\]\s*");
            if (matches.Count == 0)
            {
                results.Add((Guid.NewGuid().ToString(), content));
                return results;
            }

            for (int i = 0; i < matches.Count; i++)
            {
                var m = matches[i];
                var toolUseId = m.Groups[1].Value;
                var startIdx = m.Index + m.Length;
                var endIdx = (i + 1 < matches.Count) ? matches[i + 1].Index : content.Length;
                var resultText = content[startIdx..endIdx].Trim();
                results.Add((toolUseId, resultText));
            }
            return results;
        }

        // ── Helpers ──────────────────────────────────────────────

        private static string BuildAgentSystemPrompt(AgentLoopRequest request)
        {
            var sb = new StringBuilder();
            sb.AppendLine($"你是 {request.AgentName}，{request.AgentDescription ?? "一个AI助手"}。");
            sb.AppendLine();
            sb.AppendLine("工作方式：");
            sb.AppendLine("1. 简单问答直接回复，不要调用任何工具");
            sb.AppendLine("2. 只有确实需要读取文件、执行命令、搜索信息时才使用工具");
            sb.AppendLine("3. 调用工具后根据结果推理，然后给出最终答案");
            sb.AppendLine();
            sb.AppendLine($"沟通风格：{request.CommunicationStyle ?? "专业简洁"}");
            sb.AppendLine($"决策方式：{request.DecisionMaking ?? "理性分析"}");

            return sb.ToString();
        }

        private static string Error(string msg) =>
            JsonSerializer.Serialize(new { error = msg });
    }

    // ── Public models ─────────────────────────────────────────────

    public class AiRequest
    {
        /// <summary>Single prompt (legacy, use Messages for multi-turn).</summary>
        public string? Prompt { get; set; }

        /// <summary>Multi-turn conversation messages.</summary>
        public List<ConversationMessage>? Messages { get; set; }

        /// <summary>Model ID override.</summary>
        public string? ModelId { get; set; }

        /// <summary>Temperature (0-1).</summary>
        public double? Temperature { get; set; }

        /// <summary>Max output tokens.</summary>
        public int? MaxTokens { get; set; }

        /// <summary>Tool definitions for function calling.</summary>
        public List<ToolDefinition>? Tools { get; set; }
    }

    public class AgentLoopRequest
    {
        public string Task { get; set; } = "";
        public string AgentName { get; set; } = "Agent";
        public string AgentDescription { get; set; } = "";
        public string CommunicationStyle { get; set; } = "专业";
        public string DecisionMaking { get; set; } = "理性";
        public string? ModelId { get; set; }
        public double? Temperature { get; set; }
        public int? MaxTokens { get; set; }
        public int MaxIterations { get; set; } = 15;
    }

    public class ConversationMessage
    {
        public string Role { get; set; } = "user"; // system, user, assistant
        public string Content { get; set; } = "";
        public List<AgentToolCall>? ToolCalls { get; set; }
    }

    public class AgentToolCall
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Name { get; set; } = "";
        public Dictionary<string, object> Arguments { get; set; } = new();
    }

    public class ToolDefinition
    {
        public string Name { get; set; } = "";
        public string Description { get; set; } = "";
        public Dictionary<string, object>? Parameters { get; set; }
        public string[]? Required { get; set; }
    }

    public class AppSettings
    {
        public string Theme { get; set; } = "dark";
        public string AiProvider { get; set; } = "deepseek";
        public string ClaudeApiKey { get; set; } = "";
        public string OpenAiApiKey { get; set; } = "";
        public string DeepSeekApiKey { get; set; } = "";
        public string DefaultModel { get; set; } = "deepseek-chat";
        public bool HasCompletedOnboarding { get; set; }
    }

    public class ApiException : Exception
    {
        public int StatusCode { get; }
        public string ResponseBody { get; }

        public ApiException(string message, string body, int statusCode)
            : base(message)
        {
            ResponseBody = body;
            StatusCode = statusCode;
        }
    }
}
