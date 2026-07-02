using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Crew.App.Services;
using Microsoft.Web.WebView2.Core;
using Serilog;

namespace Crew.App
{
    public partial class MainWindow : Window
    {
        private readonly string _appDataPath;
        private readonly Services.DataService _dataService;
        private readonly Services.AiService _aiService;
        private readonly Services.OrchestrationService _orchestrationService;
        private HttpListener? _httpListener;

        public MainWindow()
        {
            InitializeComponent();

            _appDataPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".Crew");

            Directory.CreateDirectory(_appDataPath);

            Log.Logger = new LoggerConfiguration()
                .MinimumLevel.Debug()
                .WriteTo.File(Path.Combine(_appDataPath, "logs", "crew-.log"),
                    rollingInterval: RollingInterval.Day)
                .CreateLogger();

            Log.Information("Crew App starting up");

            _dataService = new Services.DataService(_appDataPath);
            _aiService = new Services.AiService();
            _orchestrationService = new Services.OrchestrationService(_aiService, _dataService);

            InitializeWebView();
        }

        private async void InitializeWebView()
        {
            try
            {
                await WebView.EnsureCoreWebView2Async();

                WebView.CoreWebView2.Settings.IsScriptEnabled = true;
                WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                WebView.CoreWebView2.Settings.IsZoomControlEnabled = false;

                WebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

                string uiFolder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui");
                if (Directory.Exists(uiFolder) && File.Exists(Path.Combine(uiFolder, "index.html")))
                {
                    // Start embedded HTTP server so ES modules + assets load reliably
                    int port = StartStaticFileServer(uiFolder);
                    WebView.CoreWebView2.Navigate($"http://localhost:{port}/index.html");
                    Log.Information("Loaded UI from embedded server http://localhost:{Port} → {Path}", port, uiFolder);
                }
                else
                {
                    WebView.CoreWebView2.Navigate("http://localhost:5173");
                    Log.Information("Loaded UI from dev server");
                }
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to initialize WebView2");
                MessageBox.Show($"WebView2 初始化失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private int StartStaticFileServer(string rootFolder)
        {
            // Try ports until one works — new listener per attempt
            for (int port = 9876; port < 9900; port++)
            {
                var listener = new HttpListener();
                try
                {
                    listener.Prefixes.Add($"http://localhost:{port}/");
                    listener.Start();
                    _httpListener = listener;
                    Task.Run(() => ServeStaticFiles(listener, rootFolder));
                    return port;
                }
                catch (HttpListenerException)
                {
                    try { listener.Close(); } catch { }
                }
            }
            throw new Exception("Could not find an available port for the UI server");
        }

        private async Task ServeStaticFiles(HttpListener listener, string rootFolder)
        {
            while (listener.IsListening)
            {
                try
                {
                    var ctx = await listener.GetContextAsync();
                    var requestPath = ctx.Request.Url!.AbsolutePath.TrimStart('/');
                    if (string.IsNullOrEmpty(requestPath)) requestPath = "index.html";

                    var filePath = Path.GetFullPath(Path.Combine(rootFolder, requestPath));
                    // Security: ensure file is within rootFolder
                    if (!filePath.StartsWith(rootFolder))
                    {
                        ctx.Response.StatusCode = 403;
                        ctx.Response.Close();
                        continue;
                    }

                    if (File.Exists(filePath))
                    {
                        var ext = Path.GetExtension(filePath).ToLower();
                        var contentType = ext switch
                        {
                            ".html" => "text/html; charset=utf-8",
                            ".js" => "application/javascript; charset=utf-8",
                            ".css" => "text/css; charset=utf-8",
                            ".svg" => "image/svg+xml",
                            ".png" => "image/png",
                            ".json" => "application/json; charset=utf-8",
                            _ => "application/octet-stream",
                        };

                        ctx.Response.ContentType = contentType;
                        ctx.Response.Headers.Add("Cache-Control", "no-cache");

                        // Inject bridge script into HTML files
                        if (ext == ".html")
                        {
                            var html = File.ReadAllText(filePath, Encoding.UTF8);
                            html = InjectBridgeIntoHtml(html);
                            var bytes = Encoding.UTF8.GetBytes(html);
                            ctx.Response.ContentLength64 = bytes.Length;
                            await ctx.Response.OutputStream.WriteAsync(bytes);
                        }
                        else
                        {
                            var bytes = File.ReadAllBytes(filePath);
                            ctx.Response.ContentLength64 = bytes.Length;
                            await ctx.Response.OutputStream.WriteAsync(bytes);
                        }
                        await ctx.Response.OutputStream.FlushAsync();
                    }
                    else
                    {
                        // SPA fallback: serve index.html for unknown paths (also with bridge)
                        var indexPath = Path.Combine(rootFolder, "index.html");
                        if (File.Exists(indexPath))
                        {
                            ctx.Response.ContentType = "text/html; charset=utf-8";
                            var html = File.ReadAllText(indexPath, Encoding.UTF8);
                            html = InjectBridgeIntoHtml(html);
                            var bytes = Encoding.UTF8.GetBytes(html);
                            ctx.Response.ContentLength64 = bytes.Length;
                            await ctx.Response.OutputStream.WriteAsync(bytes);
                            await ctx.Response.OutputStream.FlushAsync();
                        }
                        else
                        {
                            ctx.Response.StatusCode = 404;
                        }
                    }
                    ctx.Response.Close();
                }
                catch (HttpListenerException)
                {
                    break; // listener stopped
                }
                catch (Exception ex)
                {
                    Log.Debug(ex, "Error serving static file");
                }
            }
        }

        private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var payload = JsonSerializer.Deserialize<BridgeRequest>(e.WebMessageAsJson, options);
                if (payload == null) return;

                Log.Debug("Received: {Action}", payload.Action);

                var reqId = payload.Id;
                if (string.IsNullOrEmpty(reqId)) reqId = payload.StreamId;

                // ── Streaming / async actions ──
                if (payload.Action == "streamAi")
                {
                    // Send ack first
                    SendResponse(reqId, JsonSerializer.Serialize(new { streamId = payload.StreamId ?? "", status = "streaming" }), null);
                    _ = Task.Run(() => HandleStreamAiAsync(payload));
                    return;
                }

                if (payload.Action == "cancelAi")
                {
                    _aiService.CancelStream(payload.StreamId ?? "");
                    SendResponse(reqId, "{\"cancelled\":true}", null);
                    return;
                }

                if (payload.Action == "cancelTask")
                {
                    _orchestrationService.CancelTask(payload.Id ?? "");
                    SendResponse(reqId, "{\"cancelled\":true}", null);
                    return;
                }

                // ── Standard request-response actions ──
                string result;
                try
                {
                    result = payload.Action switch
                    {
                        "getAgents" => _dataService.GetAgents(),
                        "saveAgent" => _dataService.SaveAgent(payload.Data),
                        "deleteAgent" => _dataService.DeleteAgent(payload.Data),
                        "getTeams" => _dataService.GetTeams(),
                        "saveTeam" => _dataService.SaveTeam(payload.Data),
                        "deleteTeam" => _dataService.DeleteTeam(payload.Data),
                        "getTasks" => _dataService.GetTasks(),
                        "saveTask" => _dataService.SaveTask(payload.Data),
                        "deleteTask" => _dataService.DeleteTask(payload.Data),
                        "getMarketplace" => _dataService.GetMarketplaceAgents(),
                        "getSettings" => _dataService.GetSettings(),
                        "saveSettings" => _dataService.SaveSettings(payload.Data),
                        "callAi" => await _aiService.CallAsync("callAi", payload.Data, _dataService.GetSettings()),
                        "getChat" => _dataService.GetChat(payload.Data),
			"getSessions" => _dataService.GetSessions(payload.Data),
			"getSession" => _dataService.GetSession(payload.Data),
			"createSession" => _dataService.CreateSession(payload.Data),
			"deleteSession" => _dataService.DeleteSession(payload.Data),
			"renameSession" => _dataService.RenameSession(payload.Data),
                        "sendChatMessage" => _dataService.SaveChatMessage(payload.Data),
                        "publishAgent" => _dataService.PublishAgentToMarketplace(payload.Data),
                        "unpublishAgent" => _dataService.UnpublishAgent(payload.Data),
                        "getListing" => _dataService.GetListingForAgent(payload.Data),
"getWorkspaces" => _dataService.GetWorkspaces(),
"getWorkspace" => GetWorkspaceHelper(payload.Data),
			"getAllWorkspaceMessages" => GetAllWorkspaceHelper(payload.Data),
"saveWorkspaceMessage" => _dataService.SaveWorkspaceMessage(payload.Data),
			"runAgentInWorkspace" => await RunAgentInWorkspaceAsync(payload.Data),
                        "executeTaskOrchestrated" => await _orchestrationService.ExecuteAsync(payload.Data, _dataService.GetAgents(), _dataService.GetSettings()),
                        _ => throw new ArgumentException($"Unknown action: {payload.Action}")
                    };
                }
                catch (Exception ex)
                {
                    SendResponse(reqId, null, ex.Message);
                    return;
                }

                SendResponse(reqId, result, null);
                Log.Debug("Sent response for: {Action}", payload.Action);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Error handling web message");
                SendResponse(null, null, ex.Message);
            }
        }

        private void SendResponse(string? reqId, string? result, string? error)
        {
            var response = JsonSerializer.Serialize(new
            {
                id = reqId ?? "",
                result = result,
                error = error
            });
            WebView.CoreWebView2.PostWebMessageAsJson(response);
        }

        private string GetWorkspaceHelper(string? data)
        {
            try
            {
                using var doc = JsonDocument.Parse(data ?? "{}");
                var root = doc.RootElement;
                var agentId = root.GetProperty("agentId").GetString() ?? "";
                var teamId = root.GetProperty("teamId").GetString() ?? "";
                var sessionId = root.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null;
                return _dataService.GetWorkspace(agentId, teamId, sessionId);
            }
            catch { return "{}"; }
        }
private string GetAllWorkspaceHelper(string? data)
        {
            try
            {
                using var doc = JsonDocument.Parse(data ?? "{}");
                var root = doc.RootElement;
                var agentId = root.GetProperty("agentId").GetString() ?? "";
                var teamId = root.GetProperty("teamId").GetString() ?? "";
                return _dataService.GetAllWorkspaceMessages(agentId, teamId);
            }
            catch { return "{}"; }
        }

        // ── Agent workspace execution ─────────────────────────

        private async Task<string> RunAgentInWorkspaceAsync(string? data)
        {
            try
            {
                var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                using var doc = JsonDocument.Parse(data ?? "{}");
                var root = doc.RootElement;
                var agentId = root.GetProperty("agentId").GetString() ?? "";
                var teamId = root.GetProperty("teamId").GetString() ?? "";
                var task = root.GetProperty("task").GetString() ?? "";
                var context = root.TryGetProperty("context", out var ctx) ? ctx.GetString() : "";
                var sessionName = root.TryGetProperty("sessionName", out var sn) ? sn.GetString() : "";

                // Load data
                var agents = JsonSerializer.Deserialize<List<Agent>>(
                    _dataService.GetAgents(), opts) ?? new();
                var teams = JsonSerializer.Deserialize<List<Team>>(
                    _dataService.GetTeams(), opts) ?? new();
                var tasks = JsonSerializer.Deserialize<List<TaskItem>>(
                    _dataService.GetTasks(), opts) ?? new();
                var agent = agents.FirstOrDefault(a => a.Id == agentId);
                if (agent == null) return JsonSerializer.Serialize(new { error = "Agent not found" });
                var team = teams.FirstOrDefault(t => t.Id == teamId);
                var settings = JsonSerializer.Deserialize<AppSettings>(
                    _dataService.GetSettings(), opts);
                if (settings == null) return JsonSerializer.Serialize(new { error = "Settings not found" });

                // Build rich context
                var teamCtx = new List<string>();
                // 1) Team members
                if (team != null)
                {
                    teamCtx.Add("团队成员：");
                    foreach (var m in team.Members)
                    {
                        var a = agents.FirstOrDefault(x => x.Id == m.AgentId);
                        teamCtx.Add($"- {(m.IsManager ? "👑" :"")} {a?.Name ?? m.AgentId}: {a?.Description ?? ""}");
                    }
                }
                // 2) Task status — only show in-progress tasks, not session-specific
                var activeTasks = tasks.Where(t => t.TeamId == teamId && t.Status == "in_progress").ToList();
                if (activeTasks.Count > 0)
                {
                    teamCtx.Add("\n进行中的任务：");
                    foreach (var t in activeTasks)
                        teamCtx.Add($"- {t.Title} [{t.Phase}]");
                }
                // 3) Session
                if (!string.IsNullOrEmpty(sessionName))
                    teamCtx.Add($"\n当前会话：{sessionName}");

                var fullTask = $"你所在团队：{team?.Name ?? ""}\n{string.Join("\n", teamCtx)}\n\n---\n协作群最近对话：\n{context}\n\n---\n当前任务：\n{task}\n\n请处理以上任务。如果是简单问答直接回复，只有确实需要文件操作、执行命令时才使用工具。如果需要指派成员，必须使用 @成员名 格式（如 @代码助手），不能用加粗或其他格式。完成后给出对协作群最合适的回复（简洁、专业）。";
                // Log context for debugging
                Log.Information("[AGENT_CTX] Session='{Session}' Agent='{Agent}' Task='{Task}' Context='{Ctx}'",
                    sessionName ?? "(none)", agent.Name,
                    task.Length > 80 ? task[..80] + "..." : task,
                    context.Length > 200 ? context[..200] + "..." : context);

                // Run Agent Loop
                var loopReq = new AgentLoopRequest
                {
                    Task = fullTask,
                    AgentName = agent.Name,
                    AgentDescription = agent.Description ?? "",
                    CommunicationStyle = agent.Personality?.CommunicationStyle ?? "专业",
                    DecisionMaking = agent.Personality?.DecisionMaking ?? "理性",
                    ModelId = agent.Config.ModelId ?? settings.DefaultModel,
                    Temperature = agent.Config.Temperature,
                    MaxTokens = agent.Config.MaxTokens,
                    MaxIterations = 15
                };

                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
                var result = await _aiService.RunAgentLoopAsync(loopReq, settings, null, cts.Token);

                // Parse result
                string rawText;
                try
                {
                    using var resultDoc = JsonDocument.Parse(result);
                    rawText = resultDoc.RootElement.TryGetProperty("result", out var r)
                        ? r.GetString() ?? result : result;
                }
                catch { rawText = result; }

                // Save raw thinking to workspace
                _dataService.SaveWorkspaceMessage(JsonSerializer.Serialize(new
                {
                    agentId, teamId, role = "assistant",
                    content = $"[Agent Loop 执行结果]\n\n{rawText}",
                    sessionId = root.TryGetProperty("sessionId", out var sid) ? sid.GetString() : null,
                    sessionName
                }));

                // Final polish: make one quick call to produce a chat-friendly response
                Log.Debug("[AGENT_POLISH] {Agent} raw={RawLen}chars, polishing for chat...",
                    agent.Name, rawText.Length);
                string finalText = rawText;
                try
                {
                    var polishReq = new AiRequest
                    {
                        Messages = new List<ConversationMessage>
                        {
                            new() { Role = "system", Content = $"你是{agent.Name}。你刚在私有工作区完成了深度思考，现在需要在协作群里回复。你的思考结果是：\n\n{rawText}\n\n请基于以上思考，生成一条适合在协作群中发送的回复。要求：简洁、专业、有建设性。如果是简单任务直接给答案，如果是复杂任务给出结论和下一步建议。80-200字。" }
                        },
                        ModelId = agent.Config.ModelId ?? settings.DefaultModel,
                        Temperature = 0.5,
                        MaxTokens = 300
                    };
                    var polishResult = await _aiService.CallAsync("callAi",
                        JsonSerializer.Serialize(polishReq),
                        _dataService.GetSettings());
                    try
                    {
                        using var pd = JsonDocument.Parse(polishResult);
                        var prRoot = pd.RootElement;
                        // Parse actual AI response: {"choices":[{"message":{"content":"..."}}]}
                        if (prRoot.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
                        {
                            var msg = choices[0].GetProperty("message");
                            if (msg.TryGetProperty("content", out var content))
                                finalText = content.GetString() ?? rawText;
                        }
                        else if (prRoot.TryGetProperty("content", out var claudeContent) && claudeContent.GetArrayLength() > 0)
                        {
                            // Claude format: {"content":[{"type":"text","text":"..."}]}
                            var block = claudeContent[0];
                            if (block.TryGetProperty("text", out var text))
                                finalText = text.GetString() ?? rawText;
                        }
                    }
                    catch { finalText = rawText; }
                }
                catch { /* on polish failure, use raw text */ }

                Log.Information("Agent workspace execution: {Agent} completed task", agent.Name);
                return JsonSerializer.Serialize(new { result = finalText, rawResult = rawText });
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Agent workspace execution failed");
                return JsonSerializer.Serialize(new { error = ex.Message });
            }
        }

        private static string InjectBridgeIntoHtml(string html)
        {
            var bridgeScript = @"<script>
window.ClaireBridge={_p:{},_n:0,_r:null,_e:null,_s:null,
send:function(a,d){var i='r'+ ++this._n,p={action:a,data:d,id:i};
if(d&&typeof d==='object'&&d.streamId){p.streamId=d.streamId;p.data=d.data;}
window.chrome.webview.postMessage(p);
return new Promise(function(ok,no){this._p[i]={o:ok,n:no};
setTimeout(function(){if(this._p[i]){delete this._p[i];no(new Error('Timeout'));}},120000);}.bind(this));},
set onResult(f){this._r=f;},get onResult(){return this._r;},
set onError(f){this._e=f;},get onError(){return this._e;},
set onStreamEvent(f){this._s=f;},get onStreamEvent(){return this._s;}};
(function(){
function init(){window.chrome.webview.addEventListener('message',function(e){
try{var m=(typeof e.data==='string')?JSON.parse(e.data):e.data;if(!m)return;
if(m.type==='stream_event'){if(ClaireBridge._s)ClaireBridge._s({streamId:m.streamId,type:m.eventType,data:m.data});return;}
if(m.id&&ClaireBridge._p[m.id]){if(m.error){ClaireBridge._p[m.id].n(new Error(m.error));}
else{ClaireBridge._p[m.id].o(m.result);}delete ClaireBridge._p[m.id];}}
catch(x){console.error('Bridge:',x);}});}
if(window.chrome&&window.chrome.webview)init();else window.addEventListener('DOMContentLoaded',init);
})();
</script>";

            // Insert bridge script before the first <script> tag, or before </head>
            if (html.Contains("<script"))
            {
                var idx = html.IndexOf("<script");
                html = html[..idx] + bridgeScript + html[idx..];
            }
            else
            {
                html = html.Replace("</head>", bridgeScript + "</head>");
            }
            return html;
        }

        // ── Streaming handler ─────────────────────────────────────

        private async Task HandleStreamAiAsync(BridgeRequest payload)
        {
            var streamId = payload.StreamId ?? Guid.NewGuid().ToString();
            try
            {
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var settings = JsonSerializer.Deserialize<AppSettings>(_dataService.GetSettings(), options);
                var request = JsonSerializer.Deserialize<AiRequest>(payload.Data ?? "{}", options);

                if (settings == null || request == null)
                {
                    PushStreamEventSafe(streamId, "error", "无效的请求或设置");
                    return;
                }

                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
                _aiService.RegisterCancellation(streamId, cts);

                try
                {
                    await _aiService.StreamChatAsync(
                        request,
                        settings,
                        chunk =>
                        {
                            PushStreamEventSafe(streamId, "chunk", chunk);
                            return Task.CompletedTask;
                        },
                        cts.Token);

                    PushStreamEventSafe(streamId, "done", "");
                }
                finally
                {
                    _aiService.UnregisterCancellation(streamId);
                }
            }
            catch (OperationCanceledException)
            {
                PushStreamEventSafe(streamId, "cancelled", "");
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Stream AI error for {StreamId}", streamId);
                PushStreamEventSafe(streamId, "error", ex.Message);
            }
        }

        /// <summary>Marshal PostWebMessageAsJson to UI thread (WebView2 requirement).</summary>
        private void PushStreamEventSafe(string streamId, string type, string data)
        {
            Dispatcher.Invoke(() => PushStreamEvent(streamId, type, data));
        }

        private void PushStreamEvent(string streamId, string type, string data)
        {
            var ev = JsonSerializer.Serialize(new
            {
                type = "stream_event",
                streamId,
                eventType = type,
                data
            });
            WebView.CoreWebView2.PostWebMessageAsJson(ev);
        }

        protected override void OnClosed(EventArgs e)
        {
            Log.Information("Crew App shutting down");
            if (_httpListener != null)
            {
                _httpListener.Stop();
                _httpListener.Close();
            }
            Log.CloseAndFlush();
            base.OnClosed(e);
        }
    }

    public class BridgeRequest
    {
        public string Action { get; set; } = "";
        public string? Data { get; set; }
        public string? Id { get; set; }
        public string? StreamId { get; set; }
    }
}