import { Fragment, useEffect, useState } from "react";
import { App, Button, Input, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, KeyRound, Link2, LoaderCircle, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { applyCodexProvider, fetchCodexProviders, type AgentCodexProvider } from "@/services/api/canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";

const AGENT_PLUGIN_REMOVE_COMMAND = "codex plugin remove infinite-canvas";
const AGENT_MCP_REMOVE_COMMAND = "codex mcp remove infinite-canvas";

export function AgentConnectView({
    theme,
    url,
    token,
    enabled,
    connected,
    activity,
    connectError,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const permissionMode = useAgentStore((state) => state.permissionMode);
    const endpoint = url.trim().replace(/\/$/, "");
    const [providers, setProviders] = useState<AgentCodexProvider[]>([]);
    const [providersState, setProvidersState] = useState<"loading" | "ready" | "error">("loading");
    const [applyingId, setApplyingId] = useState("");
    useEffect(() => {
        if (!connected) return;
        let disposed = false;
        setProvidersState("loading");
        fetchCodexProviders(endpoint, token)
            .then((data) => {
                if (disposed) return;
                setProviders(data.providers || []);
                setProvidersState("ready");
            })
            .catch(() => {
                if (!disposed) setProvidersState("error");
            });
        return () => { disposed = true; };
    }, [connected, endpoint, token]);
    const switchProvider = async (provider: AgentCodexProvider) => {
        if (applyingId || provider.current) return;
        setApplyingId(provider.id);
        try {
            const data = await applyCodexProvider(endpoint, token, provider.id, { clientId: "", permissionMode });
            if (data.providers) setProviders(data.providers);
            setProvidersState("ready");
            message.success(t("agent.connect.providerSwitched", { name: data.applied?.name || provider.name }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.connect.providerSwitchFailed"));
        } finally {
            setApplyingId("");
        }
    };
    const steps = [{ title: t("agent.connect.pluginTitle"), text: t("agent.connect.pluginText") }, { title: t("agent.connect.directTitle"), text: t("agent.connect.directText"), command: "npx -y @basketikun/canvas-agent@latest" }];
    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("agent.connect.commandCopied"));
    };
    const codexPluginReminder = (
        <div className="rounded-lg border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            <div className="font-medium" style={{ color: theme.node.text }}>
                {t("agent.connect.pluginReminder")}
            </div>
            <div className="mt-1">{t("agent.connect.pluginReminderText")}</div>
            <div className="mt-2 grid gap-1.5">
                {[
                    [t("agent.connect.removePlugin"), AGENT_PLUGIN_REMOVE_COMMAND],
                    [t("agent.connect.removeMcp"), AGENT_MCP_REMOVE_COMMAND],
                ].map(([label, command]) => (
                    <div key={command} className="flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                            {label}
                        </span>
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                        <Tooltip title={t("agent.connect.copyCommand")}>
                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                        </Tooltip>
                    </div>
                ))}
            </div>
        </div>
    );
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.description")}
                    </div>
                </div>
                <div className="space-y-2">
                    {steps.map((step, index) => {
                        const command = "command" in step ? step.command : "";
                        return (
                            <Fragment key={step.title}>
                                <div className="rounded-lg px-3 py-2.5">
                                    <div className="text-sm font-medium leading-5">{step.title}</div>
                                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                        {step.text}
                                    </div>
                                    {command ? (
                                        <div className="mt-2 flex items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{command}</code>
                                            <Tooltip title={t("agent.connect.copyCommand")}>
                                                <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} />
                                            </Tooltip>
                                        </div>
                                    ) : null}
                                </div>
                                {index === 0 ? codexPluginReminder : null}
                            </Fragment>
                        );
                    })}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("agent.connect.webConnection")}</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}
                                >
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("agent.connect.autoDiscover")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                {t("agent.connect.localAddress")}
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                        </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("agent.connect.token")}
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={token}
                                onChange={(event) => onTokenChange(event.target.value)}
                                placeholder={t("agent.connect.tokenPlaceholder")}
                            />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="text-sm font-medium leading-5">{t("agent.connect.providerTitle")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{t("agent.connect.providerDescription")}</div>
                    <div className="mt-3 grid gap-1.5">
                        {providersState === "loading" ? <div className="px-2 py-3 text-xs" style={{ color: theme.node.muted }}>{t("agent.connect.providerLoading")}</div> : null}
                        {providersState === "error" ? <div className="px-2 py-3 text-xs" style={{ color: "#dc2626" }}>{t("agent.connect.providerFailed")}</div> : null}
                        {providersState === "ready" && !providers.length ? <div className="px-2 py-3 text-xs" style={{ color: theme.node.muted }}>{t("agent.connect.providerEmpty")}</div> : null}
                        {providersState === "ready" ? providers.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                disabled={Boolean(applyingId) || item.current}
                                onClick={() => void switchProvider(item)}
                                className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition hover:bg-black/5 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/10 dark:disabled:hover:bg-transparent"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium">{item.name}</span>
                                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: theme.node.muted }}>{[item.model, item.baseUrl].filter(Boolean).join(" · ") || t("agent.connect.providerOfficial")}</span>
                                </span>
                                {item.current ? (
                                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-4" style={{ borderColor: "#16a34a", color: "#16a34a" }}>{t("agent.connect.providerCurrent")}</span>
                                ) : applyingId === item.id ? (
                                    <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                                ) : (
                                    <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{t("agent.connect.providerUse")}</span>
                                )}
                            </button>
                        )) : null}
                    </div>
                    <div className="mt-2 text-[11px] leading-5" style={{ color: theme.node.muted }}>{t("agent.connect.providerNotice")}</div>
                </div>
            </div>
        </div>
    );
}
