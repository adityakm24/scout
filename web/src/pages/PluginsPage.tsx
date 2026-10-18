import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Trash2, Eye, EyeOff } from "lucide-react";
import type { Translations } from "@/i18n/types";
import { Link } from "react-router";
import { api } from "@/lib/api";
import type {
  CatalogEntry,
  CatalogRemovedEntry,
  CatalogResponse,
  HubAgentPluginRow,
  PluginsHubResponse,
} from "@/lib/api";
import { Button } from "@/ui/components/button";
import { Badge } from "@/ui/components/badge";
import { Switch } from "@/ui/components/switch";
import { Spinner } from "@/ui/components/spinner";
import { CommandBlock } from "@/ui/components/command-block";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card";
import { ConfirmDialog } from "@/ui/components/confirm-dialog";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import { useToast } from "@/ui/hooks/use-toast";
import { Toast } from "@/ui/components/toast";
import { useI18n } from "@/i18n";
import { en } from "@/i18n/en";
import { PluginSlot } from "@/plugins";
import { cn } from "@/lib/utils";
import { usePageHeader } from "@/contexts/usePageHeader";

export default function PluginsPage() {
  const [hub, setHub] = useState<PluginsHubResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogConfirm, setCatalogConfirm] = useState<CatalogEntry | null>(null);
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);
  const [installId, setInstallId] = useState("");
  const [installForce, setInstallForce] = useState(false);
  const [installEnable, setInstallEnable] = useState(true);
  const [installBusy, setInstallBusy] = useState(false);
  const [rescanBusy, setRescanBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const { toast, showToast } = useToast();
  const { t } = useI18n();
  const { setAfterTitle } = usePageHeader();

  const loadHub = useCallback(() => {
    return api
      .getPluginsHub()
      .then(setHub)
      .catch(() => showToast(t.common.loading, "error"));
  }, [showToast, t.common.loading]);

  const loadCatalog = useCallback(() => {
    return api
      .getPluginsCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  useEffect(() => {
    void loadHub().finally(() => setLoading(false));
    void loadCatalog().finally(() => setCatalogLoading(false));
  }, [loadHub, loadCatalog]);

  const onInstall = async () => {
    const id = installId.trim();
    if (!id) {
      showToast(t.pluginsPage.installHint, "error");
      return;
    }
    setInstallBusy(true);
    try {
      const r = await api.installAgentPlugin({
        identifier: id,
        force: installForce,
        enable: installEnable,
      });
      showToast(`${r.plugin_name ?? id} installed`, "success");
      if ((r.warnings?.length ?? 0) > 0) showToast(r.warnings!.join(" "), "error");
      if ((r.missing_env?.length ?? 0) > 0)
        showToast(`${t.pluginsPage.missingEnvWarn} ${r.missing_env!.join(", ")}`, "error");
      setInstallId("");
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Install failed", "error");
    } finally {
      setInstallBusy(false);
    }
  };

  const onCatalogInstall = async (entry: CatalogEntry) => {
    setCatalogConfirm(null);
    setCatalogBusy(entry.name);
    try {
      const r = await api.installAgentPlugin({
        identifier: "",
        catalog_name: entry.name,
        force: entry.installed,
        enable: false,
      });
      showToast(`${r.plugin_name ?? entry.name} installed`, "success");
      if ((r.missing_env?.length ?? 0) > 0)
        showToast(`${t.pluginsPage.missingEnvWarn} ${r.missing_env!.join(", ")}`, "error");
      await Promise.all([loadHub(), loadCatalog()]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Install failed", "error");
    } finally {
      setCatalogBusy(null);
    }
  };

  const onRescan = useCallback(async () => {
    setRescanBusy(true);
    try {
      const rc = await api.rescanPlugins();
      showToast(
        `${t.pluginsPage.refreshDashboard} (${rc.count})`,
        "success",
      );
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Rescan failed", "error");
    } finally {
      setRescanBusy(false);
    }
  }, [loadHub, showToast, t.pluginsPage.refreshDashboard]);

  useEffect(() => {
    setAfterTitle(
      <Button
        ghost
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        disabled={loading || rescanBusy}
        onClick={() => void onRescan()}
        aria-label={t.pluginsPage.refreshDashboard}
      >
        {rescanBusy ? <Spinner /> : <RefreshCw />}
      </Button>,
    );
    return () => setAfterTitle(null);
  }, [loading, onRescan, rescanBusy, setAfterTitle, t.pluginsPage.refreshDashboard]);

  const setRuntimeLoading = async (name: string, fn: () => Promise<unknown>) => {
    setRowBusy(name);
    try {
      await fn();
      await loadHub();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setRowBusy(null);
    }
  };

  const rows = hub?.plugins ?? [];

  const catalogEntries = useMemo(() => {
    const entries = catalog?.entries ?? [];
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) =>
      [
        entry.name,
        entry.description,
        entry.maintainer,
        ...entry.capabilities.provides_tools,
      ].some((haystack) => haystack.toLowerCase().includes(q)),
    );
  }, [catalog, catalogSearch]);

  const removedByName = useMemo(() => {
    const map = new Map<string, CatalogRemovedEntry>();
    for (const r of catalog?.removed ?? []) map.set(r.name, r);
    return map;
  }, [catalog]);

  return (
    <div className="flex flex-col gap-4">
      <PluginSlot name="plugins:top" />

      <div className={cn("flex w-full flex-col gap-8")}>


        <Card>
          <CardHeader>
            <CardTitle>{t.pluginsPage.installHeading}</CardTitle>
            <p className="text-xs tracking-[0.08em] text-text-tertiary">
              {t.pluginsPage.installHint}
            </p>
          </CardHeader>


          <CardContent className="flex flex-col gap-4">

            <div className="flex flex-col gap-2">

              <Label htmlFor="install-url">{t.pluginsPage.identifierLabel}</Label>

              <Input
                className="font-mono-ui lowercase"
                id="install-url"
                placeholder="owner/repo, owner/repo/subdir, or https://..."
                spellCheck={false}
                value={installId}
                onChange={(e) => setInstallId(e.target.value)}
              />
            </div>


            <div className="flex flex-wrap items-center gap-8">

              <div className="flex items-center gap-3">

                <Switch checked={installForce} onCheckedChange={setInstallForce} />

                <span className="text-xs tracking-[0.06em] text-text-secondary">
                  {t.pluginsPage.forceReinstall}
                </span>
              </div>

              <div className="flex items-center gap-3">

                <Switch checked={installEnable} onCheckedChange={setInstallEnable} />

                <span className="text-xs tracking-[0.06em] text-text-secondary">
                  {t.pluginsPage.enableAfterInstall}
                </span>
              </div>
            </div>

            <Button
              className="w-fit uppercase"
              size="sm"
              disabled={installBusy}
              onClick={() => void onInstall()}
              prefix={installBusy ? <Spinner /> : undefined}
            >
              {t.pluginsPage.installBtn}
            </Button>

            <p className="text-xs tracking-[0.06em] text-text-tertiary">
              {t.pluginsPage.rescanHint}
            </p>

            <p className="text-xs tracking-[0.06em] text-text-tertiary">
              {t.pluginsPage.removeHint}
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3" data-testid="plugin-catalog-section">

          <h3 className="font-display text-display text-xs tracking-[0.12em] text-text-secondary">
            {t.pluginsPage.catalogHeading ?? "Plugin catalog"}
          </h3>

          <p className="text-xs tracking-[0.06em] text-text-tertiary">
            {t.pluginsPage.catalogHint ??
              "Curated, SpaceshipResearch-reviewed plugins pinned to exact commits."}
          </p>

          <Input
            className="max-w-md"
            placeholder={t.pluginsPage.catalogSearchPlaceholder ?? "Search catalog..."}
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
            aria-label={t.pluginsPage.catalogSearchPlaceholder ?? "Search catalog..."}
          />

          {catalogLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-text-tertiary">
              <Spinner />
              <span>{t.common.loading}</span>
            </div>
          ) : catalogEntries.length === 0 ? (
            <p className="text-xs text-text-tertiary">
              {t.pluginsPage.catalogEmpty ?? "No catalog entries match."}{" "}
              <a
                className="underline"
                href="https://github.com/adityakm24/scout"
                target="_blank"
                rel="noreferrer"
              >
                {t.pluginsPage.catalogEmptyDocsLink ?? "Learn about Scout plugins"}
              </a>
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {catalogEntries.map((entry) => (
                <li key={entry.name}>
                  <CatalogEntryCard
                    busy={catalogBusy === entry.name}
                    entry={entry}
                    onInstall={() => setCatalogConfirm(entry)}
                    removed={removedByName.get(entry.name) ?? null}
                    t={t}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3">

          <h3 className="font-display text-display text-xs tracking-[0.12em] text-text-secondary">
            {t.pluginsPage.pluginListHeading}
          </h3>

          {loading ? (

            <div className="flex items-center gap-2 py-8 text-xs text-text-tertiary">

              <Spinner />
              <span>{t.common.loading}</span>
            </div>
          ) : rows.length === 0 ? (

            <p className="text-xs text-text-tertiary">{t.common.noResults}</p>
          ) : (

            <ul className="flex flex-col gap-3">

              {rows.map((row: HubAgentPluginRow) => (

                <li key={row.name}>


                  <PluginRowCard
                    {...{ row, rowBusy, setRuntimeLoading, showToast, t }}
                  />

                </li>
              ))}
            </ul>
          )}
        </div>

        {(hub?.orphan_dashboard_plugins?.length ?? 0) > 0 ? (


          <div className="flex flex-col gap-3 opacity-95">

            <h3 className="font-display text-display text-xs tracking-[0.12em] text-text-secondary">
              {t.pluginsPage.orphanHeading}
            </h3>

            <ul className="flex flex-col gap-2 rounded border border-current/15 p-4">

              {hub!.orphan_dashboard_plugins.map((m) => (

                <li className="text-xs text-text-secondary" key={m.name}>


                  {m.label ?? m.name} — {m.description || m.tab?.path}


                  {!m.tab?.hidden ? (


                    <Link className="ml-3 inline-flex items-center gap-1 underline" to={m.tab.path}>


                      <ExternalLink className="h-3 w-3 opacity-65" />

                      {t.pluginsPage.openTab}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Toast toast={toast} />
      <PluginSlot name="plugins:bottom" />

      <ConfirmDialog
        open={catalogConfirm !== null}
        onCancel={() => setCatalogConfirm(null)}
        onConfirm={() => {
          if (catalogConfirm) void onCatalogInstall(catalogConfirm);
        }}
        title={t.pluginsPage.catalogConfirmTitle ?? "Install this plugin?"}
        description={
          catalogConfirm
            ? [
                catalogConfirm.capability_summary,
                catalogConfirm.capabilities.requires_env.length
                  ? `${t.pluginsPage.catalogRequiresEnv ?? "Requires env"}: ${catalogConfirm.capabilities.requires_env.join(", ")}`
                  : "",
                t.pluginsPage.catalogConfirmInstallNote ??
                  "Plugins install disabled; enable it after install to activate.",
              ]
                .filter(Boolean)
                .join("\n\n")
            : ""
        }
        confirmLabel={t.pluginsPage.catalogInstallBtn ?? "Install"}
      />
    </div>
  );
}

interface PluginRowCardProps {

  row: HubAgentPluginRow;
  rowBusy: string | null;
  setRuntimeLoading: (
    name: string,
    fn: () => Promise<unknown>,
  ) => Promise<void>;

  showToast: (msg: string, variant: "success" | "error") => void;
  t: Translations;
}

function PluginRowCard(props: PluginRowCardProps) {
  const {
    row,
    rowBusy,
    setRuntimeLoading,
    showToast,
    t,
  } = props;

  const dm = row.dashboard_manifest;

  const tabPath = dm?.tab && !dm.tab.hidden ? dm.tab.override ?? dm.tab.path : null;

  const busy = rowBusy === row.name;
  const [confirmRemove, setConfirmRemove] = useState(false);

  const badgeTone =
    row.runtime_status === "enabled"
      ? "success"
      : row.runtime_status === "disabled"
        ? "destructive"
        : "outline";

  return (

    <Card className={cn(busy ? "opacity-70" : undefined)}>


      <CardContent className="flex flex-col gap-4 px-6 py-4">


        <div className="flex flex-wrap items-start justify-between gap-4">

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">

            <span className="truncate font-semibold">{row.name}</span>

            <Badge tone="outline">
              {t.pluginsPage.sourceBadge}: {row.source}
            </Badge>

            <Badge tone="outline">v{row.version || "—"}</Badge>

            <Badge tone={badgeTone}>{row.runtime_status}</Badge>

            {row.auth_required ? (
              <Badge tone="destructive">{t.pluginsPage.authRequired}</Badge>
            ) : null}

            {row.removed_reason ? (
              <Badge tone="destructive">
                {t.pluginsPage.catalogRemovedBadge ?? "Removed"}
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {row.runtime_status === "enabled" ? (
              <Button
                disabled={busy}
                ghost
                size="sm"
                onClick={() => {
                  void setRuntimeLoading(row.name, async () => {
                    const res = await api.disableAgentPlugin(row.name);
                    showToast(
                      res.restart_required
                        ? t.pluginsPage.toggleTakesEffectAfterRestart
                        : t.pluginsPage.disableRuntime,
                      "success",
                    );
                  });
                }}
              >
                {t.pluginsPage.disableRuntime}
              </Button>
            ) : (
              <Button
                disabled={busy}
                ghost
                size="sm"
                onClick={() => {
                  void setRuntimeLoading(row.name, async () => {
                    const res = await api.enableAgentPlugin(row.name);
                    showToast(
                      res.restart_required
                        ? t.pluginsPage.toggleTakesEffectAfterRestart
                        : t.pluginsPage.enableRuntime,
                      "success",
                    );
                  });
                }}
              >
                {t.pluginsPage.enableRuntime}
              </Button>
            )}

            {tabPath ? (

              <Link
                className={cn(
                  "inline-flex items-center rounded-none px-3 py-1.5",
                  "border border-current/25 hover:bg-current/10",
                  "font-display text-display text-xs tracking-[0.1em]",
                )}
                to={tabPath}
              >
                {t.pluginsPage.openTab}
              </Link>
            ) : null}

            {row.can_update_git ? (

              <Button
                disabled={busy}
                ghost
                size="sm"
                onClick={() => {
                  void setRuntimeLoading(row.name, async () => {
                    const res = await api.updateAgentPlugin(row.name);
                    if (res.consent_required) {
                      // The new pin widens the plugin; the backend changed nothing until confirmed.
                      const body = [
                        (t.pluginsPage.updateConsentBody ?? en.pluginsPage.updateConsentBody!)(
                          row.name,
                          (res.sha ?? "").slice(0, 8),
                        ),
                        ...(res.delta_lines ?? []),
                      ].join("\n");
                      if (!window.confirm(body)) return;
                      await api.updateAgentPlugin(row.name, true);
                    }
                    showToast(t.pluginsPage.updateGit, "success");
                  });
                }}
              >
                {busy ? <Spinner /> : null}
                {t.pluginsPage.updateGit}
              </Button>
            ) : null}

            {row.has_dashboard_manifest ? (
              <Button
                disabled={busy}
                ghost
                size="sm"
                title={row.user_hidden ? t.pluginsPage.showInSidebar : t.pluginsPage.hideFromSidebar}
                onClick={() => {
                  void setRuntimeLoading(row.name, async () => {
                    await api.setPluginVisibility(row.name, !row.user_hidden);
                  });
                }}
              >
                {row.user_hidden ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {row.user_hidden ? t.pluginsPage.showInSidebar : t.pluginsPage.hideFromSidebar}
              </Button>
            ) : null}

            {row.can_remove ? (


              <Button
                destructive
                disabled={busy}
                ghost
                size="sm"
                onClick={() => setConfirmRemove(true)}
              >

                {busy ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
          </div>
        </div>

        {row.description ? (
          <p className="min-w-0 w-full text-xs tracking-[0.06em] text-text-secondary break-words">
            {row.description}
          </p>
        ) : null}

        {row.removed_reason ? (
          <p className="border border-destructive/50 px-3 py-2 text-xs text-destructive">
            {t.pluginsPage.removedFromCatalog ?? "Removed from catalog"}: {row.removed_reason}
          </p>
        ) : null}

        {dm?.slots?.length ? (

          <p className="text-xs tracking-[0.05em] text-text-tertiary">
            {t.pluginsPage.dashboardSlots}: {dm.slots.join(", ")}
          </p>
        ) : null}

        {row.auth_required ? (
          <CommandBlock
            label={t.pluginsPage.authRequiredHint}
            code={row.auth_command}
          />
        ) : null}

        {!row.has_dashboard_manifest && !dm ? (


          <p className="text-xs italic text-text-disabled">
            {t.pluginsPage.noDashboardTab}
          </p>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirmRemove}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          void setRuntimeLoading(row.name, async () => {
            await api.removeAgentPlugin(row.name);
            showToast(`${row.name} removed`, "success");
          });
        }}
        title={t.pluginsPage.removeConfirm}
        description={`This will remove the "${row.name}" plugin from your agent.`}
        destructive
        confirmLabel={t.common.delete}
      />
    </Card>
  );
}

interface CatalogEntryCardProps {
  busy: boolean;
  entry: CatalogEntry;
  onInstall: () => void;
  removed: CatalogRemovedEntry | null;
  t: Translations;
}

function CatalogEntryCard(props: CatalogEntryCardProps) {
  const { busy, entry, onInstall, removed, t } = props;

  const caps = entry.capabilities;
  const chips: string[] = [];
  if (caps.provides_tools.length) chips.push(`${caps.provides_tools.length} tools`);
  if (caps.provides_hooks.length) chips.push(`${caps.provides_hooks.length} hooks`);
  if (caps.provides_middleware.length)
    chips.push(`${caps.provides_middleware.length} middleware`);
  if (caps.requires_env.length) chips.push(`env: ${caps.requires_env.join(", ")}`);

  const isRemoved = removed !== null;

  return (
    <Card className={cn(busy ? "opacity-70" : undefined)}>
      <CardContent className="flex flex-col gap-3 px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <span className="truncate font-semibold">{entry.name}</span>

            <Badge tone={entry.tier === "official" ? "success" : "secondary"}>
              {entry.tier}
            </Badge>

            {entry.installed && entry.runtime_status ? (
              <Badge tone="outline">{entry.runtime_status}</Badge>
            ) : null}

            {isRemoved ? (
              <Badge tone="destructive">
                {t.pluginsPage.catalogRemovedBadge ?? "Removed"}
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isRemoved ? null : entry.installed && !entry.update_available ? (
              <Badge tone="success">
                {t.pluginsPage.catalogInstalledBadge ?? "Installed ✓"}
              </Badge>
            ) : (
              <Button disabled={busy} ghost size="sm" onClick={onInstall}>
                {busy ? <Spinner /> : null}
                {entry.update_available
                  ? t.pluginsPage.catalogUpdateBtn ?? "Update available"
                  : t.pluginsPage.catalogInstallBtn ?? "Install"}
              </Button>
            )}
          </div>
        </div>

        {isRemoved ? (
          <p className="border border-destructive/50 px-3 py-2 text-xs text-destructive">
            {t.pluginsPage.removedFromCatalog ?? "Removed from catalog"}
            {removed.reason ? `: ${removed.reason}` : ""}
            {removed.date ? ` (${removed.date})` : ""}
          </p>
        ) : null}

        {entry.description ? (
          <p className="min-w-0 w-full text-xs tracking-[0.06em] text-text-secondary break-words">
            {entry.description}
          </p>
        ) : null}

        {chips.length ? (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <code
                key={chip}
                className="border border-border bg-background/40 px-2 py-1 font-mono text-[0.6875rem]"
              >
                {chip}
              </code>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
          <span>{entry.maintainer}</span>

          <a
            className="inline-flex items-center gap-1 font-mono underline"
            href={`${entry.repo.replace(/\.git$/, "")}/tree/${entry.sha}`}
            target="_blank"
            rel="noreferrer"
          >
            {entry.sha_short}
            <ExternalLink className="h-3 w-3 opacity-65" />
          </a>

          {entry.docs_url ? (
            <a
              className="inline-flex items-center gap-1 underline"
              href={entry.docs_url}
              target="_blank"
              rel="noreferrer"
            >
              docs
              <ExternalLink className="h-3 w-3 opacity-65" />
            </a>
          ) : null}

          {entry.requires_scout ? (
            <span>scout {entry.requires_scout}</span>
          ) : null}

          {entry.platforms.length ? (
            <span>{entry.platforms.join(", ")}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
