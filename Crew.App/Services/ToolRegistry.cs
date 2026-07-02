using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Serilog;

namespace Crew.App.Services
{
    /// <summary>
    /// Registry of tools that agents can call during their ReAct loop.
    /// Extensible — add more tools here to expand agent capabilities.
    /// </summary>
    public static class ToolRegistry
    {
        private static string _workspaceRoot = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        /// <summary>Set the workspace root for file operations.</summary>
        public static void SetWorkspace(string path)
        {
            if (Directory.Exists(path))
                _workspaceRoot = path;
        }

        /// <summary>Get all available tool definitions sent to the AI.</summary>
        public static List<ToolDefinition> GetStandardTools()
        {
            return new List<ToolDefinition>
            {
                new()
                {
                    Name = "read_file",
                    Description = "读取文件内容。可以读取文本文件、代码文件等。返回文件内容。",
                    Parameters = new Dictionary<string, object>
                    {
                        ["filePath"] = new { type = "string", description = "文件路径（绝对路径或相对于工作目录的路径）" }
                    },
                    Required = new[] { "filePath" }
                },
                new()
                {
                    Name = "write_file",
                    Description = "将内容写入文件。会创建目录（如果不存在）。用于保存代码、报告、配置等。",
                    Parameters = new Dictionary<string, object>
                    {
                        ["filePath"] = new { type = "string", description = "文件路径" },
                        ["content"] = new { type = "string", description = "要写入的内容" }
                    },
                    Required = new[] { "filePath", "content" }
                },
                new()
                {
                    Name = "list_files",
                    Description = "列出目录中的文件和子目录。用于探索项目结构。",
                    Parameters = new Dictionary<string, object>
                    {
                        ["directoryPath"] = new { type = "string", description = "目录路径，默认为工作目录" },
                        ["pattern"] = new { type = "string", description = "文件名匹配模式，如 *.cs, *.tsx" }
                    },
                    Required = new[] { "directoryPath" }
                },
                new()
                {
                    Name = "web_search",
                    Description = "搜索互联网获取信息。注意：这是一个模拟搜索，返回提示信息。在桌面应用中，需要浏览器集成才能执行真正的网络搜索。",
                    Parameters = new Dictionary<string, object>
                    {
                        ["query"] = new { type = "string", description = "搜索关键词" }
                    },
                    Required = new[] { "query" }
                },
                new()
                {
                    Name = "execute_command",
                    Description = "执行命令行命令并返回结果。仅用于开发和自动化任务。对于危险操作会要求确认。",
                    Parameters = new Dictionary<string, object>
                    {
                        ["command"] = new { type = "string", description = "要执行的命令" },
                        ["workingDirectory"] = new { type = "string", description = "工作目录，默认为项目根目录" }
                    },
                    Required = new[] { "command" }
                },
            };
        }

        /// <summary>Execute a tool by name with the given arguments.</summary>
        public static async Task<string> ExecuteAsync(
            string toolName,
            Dictionary<string, object> args,
            CancellationToken cancelToken)
        {
            try
            {
                return toolName switch
                {
                    "read_file" => await ReadFileAsync(args, cancelToken),
                    "write_file" => await WriteFileAsync(args, cancelToken),
                    "list_files" => await ListFilesAsync(args, cancelToken),
                    "web_search" => await WebSearchAsync(args, cancelToken),
                    "execute_command" => await ExecuteCommandAsync(args, cancelToken),
                    _ => $"未知工具: {toolName}"
                };
            }
            catch (OperationCanceledException)
            {
                return "操作已取消";
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Tool {ToolName} execution failed", toolName);
                return $"工具执行出错: {ex.Message}";
            }
        }

        // ── Tool implementations ─────────────────────────────────

        private static Task<string> ReadFileAsync(Dictionary<string, object> args, CancellationToken cancelToken)
        {
            var filePath = ResolvePath(args.GetValueOrDefault("filePath")?.ToString() ?? "");
            if (string.IsNullOrEmpty(filePath))
                return Task.FromResult("错误: 未指定文件路径");

            if (!File.Exists(filePath))
                return Task.FromResult($"错误: 文件不存在: {filePath}");

            // Security: refuse to read files larger than 1MB
            var info = new FileInfo(filePath);
            if (info.Length > 1_000_000)
                return Task.FromResult($"错误: 文件过大 ({info.Length / 1024}KB)，超过1MB限制");

            var content = File.ReadAllText(filePath, Encoding.UTF8);
            var lines = content.Split('\n');

            // Truncate if too long
            if (lines.Length > 500)
            {
                var truncated = string.Join("\n", lines.Take(500));
                return Task.FromResult($"{truncated}\n\n... (截断，共 {lines.Length} 行，仅显示前500行)");
            }

            Log.Information("Tool read_file: {Path} ({Lines} lines)", filePath, lines.Length);
            return Task.FromResult(content);
        }

        private static async Task<string> WriteFileAsync(Dictionary<string, object> args, CancellationToken cancelToken)
        {
            var filePath = ResolvePath(args.GetValueOrDefault("filePath")?.ToString() ?? "");
            var content = args.GetValueOrDefault("content")?.ToString() ?? "";

            if (string.IsNullOrEmpty(filePath))
                return "错误: 未指定文件路径";

            // Security check
            if (!IsPathSafe(filePath))
                return $"错误: 安全限制，不允许写入到该路径: {filePath}";

            var dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            await File.WriteAllTextAsync(filePath, content, Encoding.UTF8, cancelToken);
            Log.Information("Tool write_file: {Path} ({Length} chars)", filePath, content.Length);
            return $"成功写入文件: {filePath} ({content.Length} 字符)";
        }

        private static Task<string> ListFilesAsync(Dictionary<string, object> args, CancellationToken cancelToken)
        {
            var dirPath = ResolvePath(args.GetValueOrDefault("directoryPath")?.ToString() ?? _workspaceRoot);
            var pattern = args.GetValueOrDefault("pattern")?.ToString() ?? "*";

            if (!Directory.Exists(dirPath))
                return Task.FromResult($"错误: 目录不存在: {dirPath}");

            var entries = new List<string>();
            try
            {
                foreach (var dir in Directory.GetDirectories(dirPath))
                    entries.Add($"[目录] {Path.GetFileName(dir)}/");

                foreach (var file in Directory.GetFiles(dirPath, pattern))
                {
                    var info = new FileInfo(file);
                    entries.Add($"[文件] {Path.GetFileName(file)} ({FormatSize(info.Length)})");
                }
            }
            catch (Exception ex)
            {
                return Task.FromResult($"列出目录出错: {ex.Message}");
            }

            if (entries.Count == 0)
                return Task.FromResult($"目录为空: {dirPath} (匹配: {pattern})");

            if (entries.Count > 200)
            {
                var top = entries.Take(200).ToList();
                return Task.FromResult(string.Join("\n", top) + $"\n\n... (共 {entries.Count} 项，显示前200)");
            }

            Log.Information("Tool list_files: {Dir} pattern={Pattern} → {Count} entries", dirPath, pattern, entries.Count);
            return Task.FromResult(string.Join("\n", entries));
        }

        private static Task<string> WebSearchAsync(Dictionary<string, object> args, CancellationToken cancelToken)
        {
            var query = args.GetValueOrDefault("query")?.ToString() ?? "";

            // Placeholder — real web search needs browser integration or search API
            var result = string.Join("\n",
                $"[模拟网络搜索] 查询: \"{query}\"",
                "",
                "网络搜索功能当前为模拟模式。可以通过以下方式实现真正的搜索:",
                "1. 打开系统默认浏览器搜索",
                "2. 集成 SerpAPI / Tavily / Bing Search API",
                "3. 使用 WebView2 控件在应用内搜索",
                "",
                "基于你的查询，建议尝试:",
                "- 编程问题：搜索官方文档",
                "- 最新信息：使用浏览器搜索",
                "- Crew 即将通过 Computer Use 支持自动浏览器搜索");
            return Task.FromResult(result);
        }

        private static async Task<string> ExecuteCommandAsync(Dictionary<string, object> args, CancellationToken cancelToken)
        {
            var command = args.GetValueOrDefault("command")?.ToString() ?? "";
            var workingDir = ResolvePath(args.GetValueOrDefault("workingDirectory")?.ToString() ?? _workspaceRoot);

            if (string.IsNullOrEmpty(command))
                return "错误: 未指定命令";

            // Warning for dangerous commands
            var lowerCmd = command.ToLower().Trim();
            var dangerous = new[] { "format", "del /f", "rm -rf", "shutdown", "restart", ":(){ :|:& };:" };
            if (dangerous.Any(d => lowerCmd.Contains(d)))
                return $"错误: 该命令被安全策略拒绝: {command}。如需执行，请手动在终端运行。";

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c \"{command}\"",
                    WorkingDirectory = workingDir,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = Process.Start(psi);
                if (process == null) return "错误: 无法启动进程";

                var output = new StringBuilder();
                var error = new StringBuilder();

                var readOutput = process.StandardOutput.ReadToEndAsync();
                var readError = process.StandardError.ReadToEndAsync();

                // Wait with timeout
                var exited = await Task.Run(() => process.WaitForExit(30000), cancelToken);
                if (!exited)
                {
                    process.Kill();
                    return "错误: 命令执行超时 (30秒)";
                }

                output.Append(await readOutput);
                error.Append(await readError);

                var result = new StringBuilder();
                if (output.Length > 0) result.AppendLine(output.ToString());
                if (error.Length > 0) result.AppendLine("STDERR:").Append(error.ToString());

                var finalResult = result.ToString().Trim();
                if (finalResult.Length > 5000)
                    finalResult = finalResult[..5000] + "\n\n... (输出截断)";

                Log.Information("Tool execute_command: {Cmd} (exit={Code})", command, process.ExitCode);
                return string.IsNullOrEmpty(finalResult)
                    ? $"命令执行完成 (退出码: {process.ExitCode})，无输出"
                    : finalResult;
            }
            catch (Exception ex)
            {
                return $"命令执行失败: {ex.Message}";
            }
        }

        // ── Helpers ──────────────────────────────────────────────

        private static string ResolvePath(string path)
        {
            if (string.IsNullOrEmpty(path)) return _workspaceRoot;

            // Resolve relative paths against workspace root
            if (!Path.IsPathRooted(path))
                return Path.GetFullPath(Path.Combine(_workspaceRoot, path));

            return path;
        }

        private static bool IsPathSafe(string path)
        {
            var resolved = Path.GetFullPath(path);

            // Block system directories
            var systemRoots = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32"),
            };

            foreach (var root in systemRoots)
            {
                if (!string.IsNullOrEmpty(root) && resolved.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                {
                    Log.Warning("Blocked write to system path: {Path}", resolved);
                    return false;
                }
            }

            return true;
        }

        private static string FormatSize(long bytes)
        {
            return bytes switch
            {
                < 1024 => $"{bytes}B",
                < 1024 * 1024 => $"{bytes / 1024.0:F1}KB",
                < 1024 * 1024 * 1024 => $"{bytes / (1024.0 * 1024):F1}MB",
                _ => $"{bytes / (1024.0 * 1024 * 1024):F1}GB"
            };
        }
    }
}
