using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Serilog;

namespace Crew.App.Services
{
    public class DataService
    {
        private readonly string _dataPath;
        private readonly JsonSerializerOptions _jsonOptions;

        public DataService(string appDataPath)
        {
            _dataPath = appDataPath;
            _jsonOptions = new JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNameCaseInsensitive = true
            };
            EnsureDataFiles();
        }

        private void EnsureDataFiles()
        {
            EnsureFile("agents.json", "[]");
            EnsureFile("teams.json", "[]");
            EnsureFile("tasks.json", "[]");
            EnsureFile("marketplace.json", GetDefaultMarketplace());
            EnsureFile("settings.json", GetDefaultSettings());
            EnsureFile("chats.json", "[]");
            EnsureFile("listings.json", "[]");
        }

        private void EnsureFile(string filename, string defaultContent)
        {
            string path = Path.Combine(_dataPath, filename);
            if (!File.Exists(path))
            {
                File.WriteAllText(path, defaultContent);
                Log.Information("Created {File}", path);
            }
        }

        private string GetDefaultMarketplace()
        {
            var agents = new[]
            {
                new { Id = Guid.NewGuid().ToString(), Name = "代码助手", Description = "熟练掌握多种编程语言，擅长代码编写和调试", Capabilities = new[] { "code_generation", "code_review" }, Cost = 50, IsBuiltIn = true },
                new { Id = Guid.NewGuid().ToString(), Name = "数据分析员", Description = "精通 SQL 和数据可视化，能快速从数据中提取洞察", Capabilities = new[] { "data_analysis", "sql_query" }, Cost = 80, IsBuiltIn = true },
                new { Id = Guid.NewGuid().ToString(), Name = "研究员", Description = "擅长信息检索和总结，能进行深度调研", Capabilities = new[] { "research", "text_processing" }, Cost = 60, IsBuiltIn = true },
                new { Id = Guid.NewGuid().ToString(), Name = "规划师", Description = "擅长任务拆解和进度跟踪，保证项目按时交付", Capabilities = new[] { "planning", "communication" }, Cost = 70, IsBuiltIn = true },
                new { Id = Guid.NewGuid().ToString(), Name = "设计师", Description = "有审美 sense，能产出 UI 方案和设计方案", Capabilities = new[] { "design", "communication" }, Cost = 90, IsBuiltIn = true }
            };
            return JsonSerializer.Serialize(agents, _jsonOptions);
        }

        private string GetDefaultSettings()
        {
            var settings = new
            {
                Theme = "dark",
                AiProvider = "claude",
                ClaudeApiKey = "",
                OpenAiApiKey = "",
                DefaultModel = "claude-sonnet-4-20250514",
                HasCompletedOnboarding = false
            };
            return JsonSerializer.Serialize(settings, _jsonOptions);
        }

        private string ReadFile(string filename)
        {
            string path = Path.Combine(_dataPath, filename);
            return File.ReadAllText(path);
        }

        private void WriteFile(string filename, string content)
        {
            string path = Path.Combine(_dataPath, filename);
            File.WriteAllText(path, content);
            Log.Debug("Wrote {File}", filename);
        }

        public string GetAgents() => ReadFile("agents.json");
        public string GetTeams() => ReadFile("teams.json");
        public string GetTasks() => ReadFile("tasks.json");
        public string GetMarketplaceAgents() => ReadFile("marketplace.json");
        public string GetSettings() => ReadFile("settings.json");
        public string GetChats() => ReadFile("chats.json");
        public string GetListings() => ReadFile("listings.json");

        public string SaveAgent(string? data)
        {
            if (string.IsNullOrEmpty(data)) return "null";
            var agents = JsonSerializer.Deserialize<List<Agent>>(ReadFile("agents.json"), _jsonOptions) ?? new();
            var agent = JsonSerializer.Deserialize<Agent>(data, _jsonOptions);
            if (agent == null) return "null";

            var existing = agents.FindIndex(a => a.Id == agent.Id);
            if (existing >= 0) agents[existing] = agent;
            else agents.Add(agent);

            WriteFile("agents.json", JsonSerializer.Serialize(agents, _jsonOptions));
            return JsonSerializer.Serialize(agent, _jsonOptions);
        }

        public string DeleteAgent(string? id)
        {
            if (string.IsNullOrEmpty(id)) return "false";
            var agents = JsonSerializer.Deserialize<List<Agent>>(ReadFile("agents.json"), _jsonOptions) ?? new();
            agents.RemoveAll(a => a.Id == id);
            WriteFile("agents.json", JsonSerializer.Serialize(agents, _jsonOptions));

            var listings = JsonSerializer.Deserialize<List<ListingItem>>(ReadFile("listings.json"), _jsonOptions) ?? new();
            listings.RemoveAll(l => l.AgentId == id);
            WriteFile("listings.json", JsonSerializer.Serialize(listings, _jsonOptions));

            return "true";
        }

        public string SaveTeam(string? data)
        {
            if (string.IsNullOrEmpty(data)) return "null";
            var teams = JsonSerializer.Deserialize<List<Team>>(ReadFile("teams.json"), _jsonOptions) ?? new();
            var team = JsonSerializer.Deserialize<Team>(data, _jsonOptions);
            if (team == null) return "null";

            var existing = teams.FindIndex(t => t.Id == team.Id);
            if (existing >= 0) teams[existing] = team;
            else teams.Add(team);

            WriteFile("teams.json", JsonSerializer.Serialize(teams, _jsonOptions));
            return JsonSerializer.Serialize(team, _jsonOptions);
        }

        public string DeleteTeam(string? id)
        {
            if (string.IsNullOrEmpty(id)) return "false";
            var teams = JsonSerializer.Deserialize<List<Team>>(ReadFile("teams.json"), _jsonOptions) ?? new();
            teams.RemoveAll(t => t.Id == id);
            WriteFile("teams.json", JsonSerializer.Serialize(teams, _jsonOptions));

            var chats = JsonSerializer.Deserialize<List<ChatSession>>(ReadFile("chats.json"), _jsonOptions) ?? new();
            chats.RemoveAll(c => c.TeamId == id);
            WriteFile("chats.json", JsonSerializer.Serialize(chats, _jsonOptions));

            return "true";
        }

        public string SaveTask(string? data)
        {
            if (string.IsNullOrEmpty(data)) return "null";
            var tasks = JsonSerializer.Deserialize<List<TaskItem>>(ReadFile("tasks.json"), _jsonOptions) ?? new();
            var task = JsonSerializer.Deserialize<TaskItem>(data, _jsonOptions);
            if (task == null) return "null";

            var existing = tasks.FindIndex(t => t.Id == task.Id);
            if (existing >= 0) tasks[existing] = task;
            else tasks.Add(task);

            WriteFile("tasks.json", JsonSerializer.Serialize(tasks, _jsonOptions));
            return JsonSerializer.Serialize(task, _jsonOptions);
        }

        public string DeleteTask(string? id)
        {
            if (string.IsNullOrEmpty(id)) return "false";
            var tasks = JsonSerializer.Deserialize<List<TaskItem>>(ReadFile("tasks.json"), _jsonOptions) ?? new();
            tasks.RemoveAll(t => t.Id == id);
            WriteFile("tasks.json", JsonSerializer.Serialize(tasks, _jsonOptions));
            return "true";
        }

        public string SaveSettings(string? data)
        {
            if (string.IsNullOrEmpty(data)) return GetSettings();
            WriteFile("settings.json", data);
            return data;
        }

        public string GetChat(string? teamId)
        {
            if (string.IsNullOrEmpty(teamId)) return "null";
            var chats = JsonSerializer.Deserialize<List<ChatSession>>(ReadFile("chats.json"), _jsonOptions) ?? new();
            var chat = chats.Find(c => c.TeamId == teamId);
            return JsonSerializer.Serialize(chat ?? new ChatSession { TeamId = teamId, Messages = new() }, _jsonOptions);
        }

        public string SaveChatMessage(string? data)
        {
            if (string.IsNullOrEmpty(data)) return "null";
            var chats = JsonSerializer.Deserialize<List<ChatSession>>(ReadFile("chats.json"), _jsonOptions) ?? new();
            var msg = JsonSerializer.Deserialize<ChatMessage>(data, _jsonOptions);
            if (msg == null) return "null";

            var chat = chats.Find(c => c.TeamId == msg.TeamId);
            if (chat == null)
            {
                chat = new ChatSession { TeamId = msg.TeamId, Messages = new() };
                chats.Add(chat);
            }

            chat.Messages.Add(msg);
            WriteFile("chats.json", JsonSerializer.Serialize(chats, _jsonOptions));
            return JsonSerializer.Serialize(msg, _jsonOptions);
        }

        public string PublishAgentToMarketplace(string? data)
        {
            if (string.IsNullOrEmpty(data)) return "null";
            var listings = JsonSerializer.Deserialize<List<ListingItem>>(ReadFile("listings.json"), _jsonOptions) ?? new();
            var listing = JsonSerializer.Deserialize<ListingItem>(data, _jsonOptions);
            if (listing == null) return "null";

            var existing = listings.FindIndex(l => l.AgentId == listing.AgentId);
            if (existing >= 0) listings[existing] = listing;
            else listings.Add(listing);

            WriteFile("listings.json", JsonSerializer.Serialize(listings, _jsonOptions));
            return JsonSerializer.Serialize(listing, _jsonOptions);
        }

        public string UnpublishAgent(string? agentId)
        {
            if (string.IsNullOrEmpty(agentId)) return "false";
            var listings = JsonSerializer.Deserialize<List<ListingItem>>(ReadFile("listings.json"), _jsonOptions) ?? new();
            listings.RemoveAll(l => l.AgentId == agentId);
            WriteFile("listings.json", JsonSerializer.Serialize(listings, _jsonOptions));
            return "true";
        }

        public string GetListingForAgent(string? agentId)
        {
            if (string.IsNullOrEmpty(agentId)) return "null";
            var listings = JsonSerializer.Deserialize<List<ListingItem>>(ReadFile("listings.json"), _jsonOptions) ?? new();
            var listing = listings.Find(l => l.AgentId == agentId);
            return JsonSerializer.Serialize(listing, _jsonOptions);
        }
    }

    public class Agent
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Name { get; set; } = "";
        public string Description { get; set; } = "";
        public string[] Capabilities { get; set; } = Array.Empty<string>();
        public AgentPersonality? Personality { get; set; }
        public AgentConfig Config { get; set; } = new();
        public int Cost { get; set; }
        public bool IsCustom { get; set; }
        public bool IsListed { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.Now;
    }

    public class AgentPersonality
    {
        public string CommunicationStyle { get; set; } = "专业";
        public string DecisionMaking { get; set; } = "理性";
    }

    public class AgentConfig
    {
        public string ModelProvider { get; set; } = "claude";
        public string ModelId { get; set; } = "claude-sonnet-4-20250514";
        public double Temperature { get; set; } = 0.7;
        public int MaxTokens { get; set; } = 4096;
    }

    public class Team
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Name { get; set; } = "";
        public List<TeamMember> Members { get; set; } = new();
        public DateTime CreatedAt { get; set; } = DateTime.Now;
    }

    public class TeamMember
    {
        public string AgentId { get; set; } = "";
        public string Role { get; set; } = "member";
        public bool IsManager { get; set; }
    }

    public class TaskItem
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Title { get; set; } = "";
        public string Description { get; set; } = "";
        public string TeamId { get; set; } = "";
        public string Status { get; set; } = "pending";
        public string Result { get; set; } = "";
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime? CompletedAt { get; set; }
    }

    public class ChatSession
    {
        public string TeamId { get; set; } = "";
        public List<ChatMessage> Messages { get; set; } = new();
    }

    public class ChatMessage
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string TeamId { get; set; } = "";
        public string AgentId { get; set; } = "";
        public string AgentName { get; set; } = "";
        public string Content { get; set; } = "";
        public bool IsUser { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.Now;
    }

    public class ListingItem
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string AgentId { get; set; } = "";
        public string AgentName { get; set; } = "";
        public string Description { get; set; } = "";
        public string[] Capabilities { get; set; } = Array.Empty<string>();
        public int Price { get; set; }
        public DateTime ListedAt { get; set; } = DateTime.Now;
    }
}