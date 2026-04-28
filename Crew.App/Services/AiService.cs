using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Serilog;

namespace Crew.App.Services
{
    public class AiService
    {
        private readonly HttpClient _httpClient;

        public AiService()
        {
            _httpClient = new HttpClient();
            _httpClient.Timeout = TimeSpan.FromSeconds(120);
        }

        public async Task<string> CallAsync(string action, string? data, string settingsJson)
        {
            try
            {
                var settings = JsonSerializer.Deserialize<AppSettings>(settingsJson);
                if (settings == null) return JsonSerializer.Serialize(new { error = "无效的设置" });

                if (string.IsNullOrEmpty(settings.ClaudeApiKey) && action == "callAi")
                {
                    return JsonSerializer.Serialize(new { error = "请先在设置中配置 API Key" });
                }

                var request = JsonSerializer.Deserialize<AiRequest>(data);
                if (request == null) return JsonSerializer.Serialize(new { error = "无效的请求" });

                return settings.AiProvider switch
                {
                    "claude" => await CallClaudeAsync(request, settings.ClaudeApiKey),
                    "openai" => await CallOpenAiAsync(request, settings.OpenAiApiKey),
                    _ => JsonSerializer.Serialize(new { error = "不支持的 AI 提供商" })
                };
            }
            catch (Exception ex)
            {
                Log.Error(ex, "AI service error");
                return JsonSerializer.Serialize(new { error = ex.Message });
            }
        }

        private async Task<string> CallClaudeAsync(AiRequest request, string apiKey)
        {
            var payload = new
            {
                model = request.ModelId ?? "claude-sonnet-4-20250514",
                max_tokens = request.MaxTokens ?? 4096,
                temperature = request.Temperature ?? 0.7,
                messages = new[]
                {
                    new { role = "user", content = request.Prompt }
                }
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            _httpClient.DefaultRequestHeaders.Clear();
            _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");

            var response = await _httpClient.PostAsync(
                "https://api.anthropic.com/v1/messages",
                content);

            var responseBody = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Log.Warning("Claude API error: {Status} {Body}", response.StatusCode, responseBody);
                return JsonSerializer.Serialize(new { error = $"API 错误: {response.StatusCode}" });
            }

            using var doc = JsonDocument.Parse(responseBody);
            var text = doc.RootElement
                .GetProperty("content")[0]
                .GetProperty("text")
                .GetString();

            return JsonSerializer.Serialize(new { result = text });
        }

        private async Task<string> CallOpenAiAsync(AiRequest request, string apiKey)
        {
            var payload = new
            {
                model = request.ModelId ?? "gpt-4",
                max_tokens = request.MaxTokens ?? 4096,
                temperature = request.Temperature ?? 0.7,
                messages = new[]
                {
                    new { role = "user", content = request.Prompt }
                }
            };

            var content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json");

            _httpClient.DefaultRequestHeaders.Clear();
            _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");

            var response = await _httpClient.PostAsync(
                "https://api.openai.com/v1/chat/completions",
                content);

            var responseBody = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Log.Warning("OpenAI API error: {Status} {Body}", response.StatusCode, responseBody);
                return JsonSerializer.Serialize(new { error = $"API 错误: {response.StatusCode}" });
            }

            using var doc = JsonDocument.Parse(responseBody);
            var text = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            return JsonSerializer.Serialize(new { result = text });
        }
    }

    public class AiRequest
    {
        public string? Prompt { get; set; }
        public string? ModelId { get; set; }
        public double? Temperature { get; set; }
        public int? MaxTokens { get; set; }
    }

    public class AppSettings
    {
        public string Theme { get; set; } = "dark";
        public string AiProvider { get; set; } = "claude";
        public string ClaudeApiKey { get; set; } = "";
        public string OpenAiApiKey { get; set; } = "";
        public string DefaultModel { get; set; } = "claude-sonnet-4-20250514";
        public bool HasCompletedOnboarding { get; set; }
    }
}