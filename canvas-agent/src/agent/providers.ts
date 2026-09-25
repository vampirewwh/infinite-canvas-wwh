import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONFIG_DIR } from "../config.js";
import { logger } from "../utils/logger.js";

const CC_SWITCH_DB = path.join(os.homedir(), ".cc-switch", "cc-switch.db");
const CODEX_DIR = path.join(os.homedir(), ".codex");
const CODEX_CONFIG = path.join(CODEX_DIR, "config.toml");
const CODEX_AUTH = path.join(CODEX_DIR, "auth.json");
const BACKUP_DIR = path.join(CONFIG_DIR, "codex-config-backups");
/** 切换渠道时由渠道配置接管的 config.toml 顶层键，其余设置保持原样。 */
const PROVIDER_KEYS = ["model", "model_provider", "model_reasoning_effort", "disable_response_storage"];

export type CodexProviderSummary = { id: string; name: string; model: string; baseUrl: string; current: boolean };
type RawProvider = CodexProviderSummary & { config: string; auth: Record<string, unknown>; key: string };

/** 读取 CC Switch 中保存的 Codex 渠道，不返回任何密钥。 */
export async function listCodexProviders() {
    const providers = await readProviders();
    return {
        providers: providers.map(({ id, name, model, baseUrl, current }): CodexProviderSummary => ({ id, name, model, baseUrl, current })),
        configPath: CODEX_CONFIG,
    };
}

/** 将指定渠道写入 ~/.codex，并在写入前备份当前配置。 */
export async function applyCodexProvider(id: string) {
    const providers = await readProviders();
    const target = providers.find((item) => item.id === id);
    if (!target) throw new Error("没有找到这个 Codex 渠道，请在 CC Switch 中确认后重试");
    const backupPath = backupCodexConfig();
    fs.mkdirSync(CODEX_DIR, { recursive: true });
    fs.writeFileSync(CODEX_CONFIG, mergeProviderConfig(readText(CODEX_CONFIG), target.config), { mode: 0o600 });
    fs.writeFileSync(CODEX_AUTH, `${JSON.stringify(target.auth, null, 2)}\n`, { mode: 0o600 });
    logger.info("Applied Codex provider", { provider: target.name, model: target.model, backupPath });
    return { name: target.name, model: target.model, backupPath };
}

/** 读取 CC Switch 数据库中的 Codex 渠道，并标出当前 ~/.codex 正在使用的那一个。 */
async function readProviders(): Promise<RawProvider[]> {
    if (!fs.existsSync(CC_SWITCH_DB)) throw new Error("没有找到 CC Switch 的配置，请先安装并打开一次 CC Switch");
    const { DatabaseSync } = await import("node:sqlite").catch(() => {
        throw new Error("当前 Node 版本不支持读取 CC Switch 配置，请使用 Node 22.5 及以上版本启动 Canvas Agent");
    });
    const live = { ...readLiveProvider(readText(CODEX_CONFIG)), key: readLiveKey() };
    const db = new DatabaseSync(CC_SWITCH_DB, { readOnly: true });
    try {
        const rows = db.prepare("SELECT id, name, settings_config FROM providers WHERE app_type = 'codex' ORDER BY is_current DESC, sort_index, created_at").all() as Array<{ id: string; name: string; settings_config: string }>;
        const providers: RawProvider[] = [];
        for (const row of rows) {
            const parsed = parseSettings(row.settings_config);
            if (!parsed?.config || !parsed.auth) continue;
            const baseUrl = scalar(parsed.config, "base_url");
            providers.push({
                id: String(row.id),
                name: String(row.name || row.id),
                model: scalar(parsed.config, "model"),
                baseUrl,
                current: baseUrl ? baseUrl === live.baseUrl && (!live.key || live.key === stringValue(parsed.auth.OPENAI_API_KEY)) : !live.baseUrl,
                config: parsed.config,
                auth: parsed.auth,
                key: stringValue(parsed.auth.OPENAI_API_KEY),
            });
        }
        if (!providers.length) throw new Error("CC Switch 里还没有可用的 Codex 渠道");
        markSingleCurrent(providers, live.key);
        return providers.sort((left, right) => Number(right.current) - Number(left.current));
    } finally {
        db.close();
    }
}

/** 地址相同的渠道可能有多条，只把密钥一致（或第一条）标记为当前使用。 */
function markSingleCurrent(providers: RawProvider[], liveKey: string) {
    const matched = providers.filter((item) => item.current);
    if (!matched.length) return;
    const current = (liveKey && matched.find((item) => item.key === liveKey)) || matched[0];
    matched.forEach((item) => { item.current = item === current; });
}

/** 读取当前生效的接口密钥（auth.json 或 config.toml 内联），用于区分地址相同的渠道。 */
function readLiveKey() {
    try {
        const parsed = JSON.parse(fs.readFileSync(CODEX_AUTH, "utf8")) as { OPENAI_API_KEY?: unknown };
        const key = stringValue(parsed.OPENAI_API_KEY);
        if (key) return key;
    } catch {}
    return scalar(readText(CODEX_CONFIG), "experimental_bearer_token");
}

/** 读取字符串字段。 */
function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

/** 读取当前 config.toml 真正生效的 model_provider 及其 base_url。 */
function readLiveProvider(config: string) {
    const provider = scalar(config, "model_provider");
    if (!provider || provider === "openai") return { provider, baseUrl: "" };
    return { provider, baseUrl: scalar(tableBlock(config, `model_providers.${provider}`), "base_url") };
}

/** 截取指定表的内容，遇到下一个表头结束。 */
function tableBlock(config: string, name: string) {
    const lines = config.split(/\r?\n/);
    const start = lines.findIndex((line) => tableHeader(line) === name);
    if (start < 0) return "";
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => tableHeader(line));
    return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** 解析渠道的 settings_config，忽略格式不完整的记录。 */
function parseSettings(value: string) {
    try {
        const parsed = JSON.parse(value || "{}") as { config?: unknown; auth?: unknown };
        const config = typeof parsed.config === "string" ? parsed.config.trim() : "";
        const auth = parsed.auth && typeof parsed.auth === "object" && !Array.isArray(parsed.auth) ? parsed.auth as Record<string, unknown> : null;
        return { config, auth };
    } catch {
        return null;
    }
}

/** 只替换渠道接管的顶层键和 [model_providers.*] 表，保留 Codex 其余设置不变。 */
function mergeProviderConfig(current: string, providerConfig: string) {
    const incoming = splitToml(providerConfig);
    const lines = current.split(/\r?\n/);
    const head: string[] = [];
    const tail: string[] = [];
    let index = 0;
    for (; index < lines.length; index++) {
        const line = lines[index];
        if (/^\s*\[/.test(line)) break;
        const key = topLevelKey(line);
        if (key && PROVIDER_KEYS.includes(key)) continue;
        head.push(line);
    }
    let skipping = false;
    for (; index < lines.length; index++) {
        const header = tableHeader(lines[index]);
        if (header) skipping = header === "model_providers" || header.startsWith("model_providers.");
        if (!skipping) tail.push(lines[index]);
    }
    const sections = [trimBlank(head), incoming.scalars, incoming.tables, trimBlank(tail)].filter((items) => items.length);
    return `${sections.map((items) => items.join("\n")).join("\n\n")}\n`;
}

/** 按顶层键区和表区分割渠道配置文本。 */
function splitToml(text: string) {
    const scalars: string[] = [];
    const tables: string[] = [];
    text.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        if (tables.length || /^\s*\[/.test(line)) tables.push(line);
        else scalars.push(line);
    });
    return { scalars, tables };
}

/** 读取顶层裸键名，表内键和带引号的键不参与接管。 */
function topLevelKey(line: string) {
    return /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1] || "";
}

/** 读取表头名称，例如 [model_providers.custom] 返回 model_providers.custom。 */
function tableHeader(line: string) {
    return /^\s*\[\s*([^\]]+?)\s*\]\s*$/.exec(line)?.[1]?.replace(/["']/g, "") || "";
}

/** 读取配置里的字符串值。 */
function scalar(text: string, key: string) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "m").exec(text);
    return match?.[1] ?? match?.[2] ?? "";
}

/** 去掉首尾空行，避免拼接时留下多余空白。 */
function trimBlank(lines: string[]) {
    const result = [...lines];
    while (result.length && !result[0].trim()) result.shift();
    while (result.length && !result[result.length - 1].trim()) result.pop();
    return result;
}

/** 备份切换前的 config.toml 和 auth.json。 */
function backupCodexConfig() {
    const dir = path.join(BACKUP_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    [CODEX_CONFIG, CODEX_AUTH].forEach((file) => {
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, path.basename(file)));
    });
    return dir;
}

/** 读取文本文件，读取失败时返回空字符串。 */
function readText(file: string) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
}
