using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Serilog;

namespace Crew.App.Services
{
    public class OrchestrationService
    {
        private readonly AiService _aiService;
        private readonly DataService _dataService;

        public OrchestrationService(AiService aiService, DataService dataService)
        {
            _aiService = aiService;
            _dataService = dataService;
        }

        public async Task<string> ExecuteAsync(string taskJson, string agentsJson, string settingsJson)
        {
            try
            {
                var task = JsonSerializer.Deserialize<TaskItem>(taskJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                var agents = JsonSerializer.Deserialize<List<Agent>>(agentsJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                var settings = JsonSerializer.Deserialize<AppSettings>(settingsJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                if (task == null || agents == null || settings == null)
                    return JsonSerializer.Serialize(new { error = "无效的数据" });

                var teamAgents = agents.Where(a => task.TeamMembers.Any(m => m.AgentId == a.Id)).ToList();
                var manager = teamAgents.FirstOrDefault(a => task.TeamMembers.Any(m => m.AgentId == a.Id && m.IsManager))
                               ?? teamAgents.FirstOrDefault();

                if (manager == null)
                    return JsonSerializer.Serialize(new { error = "团队中没有可用的 Agent" });

                Log.Information("Starting orchestrated execution for task {TaskId} with manager {Manager}", task.Id, manager.Name);

                // Phase 1: Decompose
                task.Phase = "decomposing";
                var decomposed = await DecomposeTaskAsync(task, teamAgents, manager, settings);
                if (decomposed.error != null)
                    return JsonSerializer.Serialize(new { error = decomposed.error });

                task.SubTasks = decomposed.subTasks;
                PersistTaskProgress(task);
                Log.Information("Task decomposed into {Count} sub-tasks", task.SubTasks.Count);

                // Phase 2: Execute sub-tasks in parallel
                task.Phase = "executing";
                PersistTaskProgress(task);
                var executeResult = await ExecuteSubTasksParallelAsync(task, teamAgents, settings);
                if (executeResult.error != null)
                    return JsonSerializer.Serialize(new { error = executeResult.error });

                // Phase 3: Synthesize
                task.Phase = "synthesizing";
                PersistTaskProgress(task);
                var synthesis = await SynthesizeResultsAsync(task, manager, settings);
                if (synthesis.error != null)
                    return JsonSerializer.Serialize(new { error = synthesis.error });

                task.Phase = "completed";
                task.Status = "completed";
                task.Result = synthesis.result ?? "";
                task.CompletedAt = DateTime.Now;

                Log.Information("Orchestrated execution completed for task {TaskId}", task.Id);
                return JsonSerializer.Serialize(new { task });
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Orchestration error");
                return JsonSerializer.Serialize(new { error = ex.Message });
            }
        }

        private void PersistTaskProgress(TaskItem task)
        {
            _dataService.SaveTask(JsonSerializer.Serialize(task, new JsonSerializerOptions { WriteIndented = true }));
        }

        private async Task<(List<SubTask> subTasks, string? error)> DecomposeTaskAsync(
            TaskItem task, List<Agent> teamAgents, Agent manager, AppSettings settings)
        {
            var agentDescriptions = string.Join("\n", teamAgents.Select(a =>
                $"- {a.Name}: {a.Description}, 能力: {string.Join(", ", a.Capabilities)}"));

            var prompt = $@"你是一个任务规划专家。你的团队成员包括：
{agentDescriptions}

当前任务：{task.Description}

请分析任务并将其分解为针对特定成员的子任务。必须为每个子任务指定：
- title: 子任务标题
- assignedAgentId: 执行该子任务的成员ID（必须使用上述列表中的ID）
- assignedAgentName: 执行该子任务的成员名称

请以JSON数组格式返回，格式如下：
[{{""title"": ""子任务标题"", ""assignedAgentId"": ""成员ID"", ""assignedAgentName"": ""成员名称""}}]

只返回JSON，不要包含任何其他文字。确保每个子任务只分配给一个成员，并且任务分配合理。";

            var request = new AiRequest
            {
                Prompt = prompt,
                ModelId = manager.Config.ModelId ?? settings.DefaultModel,
                Temperature = 0.5,
                MaxTokens = 2048
            };

            var response = await _aiService.CallAsync("callAi", JsonSerializer.Serialize(request), JsonSerializer.Serialize(settings));

            try
            {
                using var doc = JsonDocument.Parse(response);
                if (doc.RootElement.TryGetProperty("error", out var errProp))
                    return (new List<SubTask>(), errProp.GetString());

                var subTasksJson = doc.RootElement.TryGetProperty("result", out var r)
                    ? r.GetString() : response;

                // Try parsing as {result: ...} wrapper first
                var subTasks = new List<SubTask>();
                var parsed = JsonDocument.Parse(subTasksJson ?? "[]");
                var arr = parsed.RootElement;

                if (arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in arr.EnumerateArray())
                    {
                        subTasks.Add(new SubTask
                        {
                            Title = item.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "",
                            AssignedAgentId = item.TryGetProperty("assignedAgentId", out var aid) ? aid.GetString() ?? "" : "",
                            AssignedAgentName = item.TryGetProperty("assignedAgentName", out var an) ? an.GetString() ?? "" : ""
                        });
                    }
                }

                if (subTasks.Count == 0)
                    return (new List<SubTask>(), "无法分解任务，请检查任务描述或重新尝试");

                return (subTasks, null);
            }
            catch (JsonException ex)
            {
                Log.Warning("Failed to parse decomposition response: {Response}", response);
                return (new List<SubTask>(), $"分解结果解析失败: {ex.Message}");
            }
        }

        private async Task<(bool success, string? error)> ExecuteSubTasksParallelAsync(
            TaskItem task, List<Agent> teamAgents, AppSettings settings)
        {
            var tasks = task.SubTasks.Select(async subtask =>
            {
                var agent = teamAgents.FirstOrDefault(a => a.Id == subtask.AssignedAgentId);
                if (agent == null)
                {
                    subtask.Status = "completed";
                    subtask.Result = "Agent not found";
                    return;
                }

                subtask.Status = "in_progress";

                var prompt = $"你是 {agent.Name}，{agent.Description}。\n\n你的专属任务：{subtask.Title}\n\n原始任务背景：{task.Description}\n\n请仔细思考并执行你的任务，给出详细的结果。";

                var request = new AiRequest
                {
                    Prompt = prompt,
                    ModelId = agent.Config.ModelId ?? settings.DefaultModel,
                    Temperature = agent.Config.Temperature,
                    MaxTokens = agent.Config.MaxTokens
                };

                var response = await _aiService.CallAsync("callAi", JsonSerializer.Serialize(request), JsonSerializer.Serialize(settings));

                try
                {
                    using var doc = JsonDocument.Parse(response);
                    subtask.Result = doc.RootElement.TryGetProperty("result", out var r) ? r.GetString() ?? "" : response;
                    subtask.Status = "completed";
                }
                catch
                {
                    subtask.Result = response;
                    subtask.Status = "completed";
                }
            });

            await Task.WhenAll(tasks);
            return (true, null);
        }

        private async Task<(string? result, string? error)> SynthesizeResultsAsync(
            TaskItem task, Agent manager, AppSettings settings)
        {
            var subTaskResults = string.Join("\n\n", task.SubTasks.Select(st =>
                $"【{st.AssignedAgentName} - {st.Title}】\n{st.Result}"));

            var prompt = $@"你是一个团队协作专家。以下是原始任务和各个团队成员的执行结果：

原始任务：{task.Description}

各成员执行结果：
{subTaskResults}

请综合分析所有成员的工作成果，给出一个完整、连贯的最终结果报告。如果结果之间有冲突或不一致，请进行合理的协调和整合。

直接输出综合结果，不要说明你是如何综合的。";

            var request = new AiRequest
            {
                Prompt = prompt,
                ModelId = manager.Config.ModelId ?? settings.DefaultModel,
                Temperature = 0.7,
                MaxTokens = 4096
            };

            var response = await _aiService.CallAsync("callAi", JsonSerializer.Serialize(request), JsonSerializer.Serialize(settings));

            try
            {
                using var doc = JsonDocument.Parse(response);
                return (doc.RootElement.TryGetProperty("result", out var r) ? r.GetString() : response, null);
            }
            catch
            {
                return (response, null);
            }
        }
    }
}