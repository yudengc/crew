using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Serilog;

namespace Crew.App
{
    public partial class MainWindow : Window
    {
        private readonly string _appDataPath;
        private readonly Services.DataService _dataService;
        private readonly Services.AiService _aiService;

        public MainWindow()
        {
            InitializeComponent();

            _appDataPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "CrewApp");

            Directory.CreateDirectory(_appDataPath);

            Log.Logger = new LoggerConfiguration()
                .MinimumLevel.Debug()
                .WriteTo.File(Path.Combine(_appDataPath, "logs", "crew-.log"),
                    rollingInterval: RollingInterval.Day)
                .CreateLogger();

            Log.Information("Crew App starting up");

            _dataService = new Services.DataService(_appDataPath);
            _aiService = new Services.AiService();

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

                string indexPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui", "index.html");
                if (File.Exists(indexPath))
                {
                    WebView.CoreWebView2.Navigate(new Uri(indexPath).AbsoluteUri);
                    Log.Information("Loaded UI from {Path}", indexPath);
                }
                else
                {
                    string devUrl = "http://localhost:5173";
                    WebView.CoreWebView2.Navigate(devUrl);
                    Log.Information("Loaded UI from dev server {Url}", devUrl);
                }
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to initialize WebView2");
                MessageBox.Show($"WebView2 初始化失败: {ex.Message}", "错误", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var payload = System.Text.Json.JsonSerializer.Deserialize<BridgeRequest>(e.WebMessageAsJson);
                if (payload == null) return;

                Log.Debug("Received: {Action}", payload.Action);

                string result = payload.Action switch
                {
                    "getAgents" => _dataService.GetAgents(),
                    "saveAgent" => _dataService.SaveAgent(payload.Data),
                    "deleteAgent" => _dataService.DeleteAgent(payload.Id),
                    "getTeams" => _dataService.GetTeams(),
                    "saveTeam" => _dataService.SaveTeam(payload.Data),
                    "deleteTeam" => _dataService.DeleteTeam(payload.Id),
                    "getTasks" => _dataService.GetTasks(),
                    "saveTask" => _dataService.SaveTask(payload.Data),
                    "deleteTask" => _dataService.DeleteTask(payload.Id),
                    "getMarketplace" => _dataService.GetMarketplaceAgents(),
                    "getSettings" => _dataService.GetSettings(),
                    "saveSettings" => _dataService.SaveSettings(payload.Data),
                    "callAi" => await _aiService.CallAsync("callAi", payload.Data, _dataService.GetSettings()),
                    "getChat" => _dataService.GetChat(payload.Id),
                    "sendChatMessage" => _dataService.SaveChatMessage(payload.Data),
                    "publishAgent" => _dataService.PublishAgentToMarketplace(payload.Data),
                    "unpublishAgent" => _dataService.UnpublishAgent(payload.Id),
                    "getListing" => _dataService.GetListingForAgent(payload.Id),
                    _ => throw new ArgumentException($"Unknown action: {payload.Action}")
                };

                await WebView.ExecuteScriptAsync($"window.ClaireBridge.onResult({result})");
                Log.Debug("Sent response for: {Action}", payload.Action);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Error handling web message");
                await WebView.ExecuteScriptAsync($"window.ClaireBridge.onError({System.Text.Json.JsonSerializer.Serialize(ex.Message)})");
            }
        }

        protected override void OnClosed(EventArgs e)
        {
            Log.Information("Crew App shutting down");
            Log.CloseAndFlush();
            base.OnClosed(e);
        }
    }

    public class BridgeRequest
    {
        public string Action { get; set; } = "";
        public string? Data { get; set; }
        public string? Id { get; set; }
    }
}