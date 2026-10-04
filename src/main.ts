import { EditorView } from "@codemirror/view";
import {
  MarkdownView,
  Plugin,
  TFile,
  parseFrontMatterTags,
  type CachedMetadata,
} from "obsidian";

import { PathDebouncer } from "./path-debouncer";
import {
  DEFAULT_SETTINGS,
  TagathaSettingTab,
  type TagathaSettings,
  type TagSnapshot,
} from "./settings";
import {
  createTagPropertyUpdate,
  getStableInlineTagPositions,
  getTagRemovalPlan,
  hasNormalizedTag,
  mergeTags,
  normalizeTag,
  removeInlineTags,
} from "./tag-utils";

const TAG_SYNC_DELAY_MILLISECONDS = 1_000;

export default class TagathaPlugin extends Plugin {
  settings: TagathaSettings = {
    synchronizeRemovals: DEFAULT_SETTINGS.synchronizeRemovals,
    tagSnapshots: {},
  };
  private activeFilePath: string | null = null;
  private readonly debouncer = new PathDebouncer(TAG_SYNC_DELAY_MILLISECONDS);
  private readonly syncChains = new Map<string, Promise<void>>();
  private settingsSaveChain = Promise.resolve();
  private isUnloading = false;

  onload(): void {
    void this.initialize();
  }

  onunload(): void {
    this.isUnloading = true;
    this.activeFilePath = null;
    this.debouncer.clearAll();
    this.syncChains.clear();
  }

  async setRemovalSynchronization(enabled: boolean): Promise<void> {
    if (this.settings.synchronizeRemovals === enabled) {
      return;
    }

    this.settings.synchronizeRemovals = enabled;
    this.settings.tagSnapshots = enabled ? this.collectTagSnapshots() : {};
    await this.persistSettings();
  }

  private async initialize(): Promise<void> {
    await this.loadSettings();
    if (this.isUnloading) {
      return;
    }

    this.addSettingTab(new TagathaSettingTab(this));
    this.app.workspace.onLayoutReady(() => {
      this.activeFilePath = this.app.workspace.getActiveFile()?.path ?? null;
    });

    this.registerEvent(
      this.app.metadataCache.on(
        "changed",
        (file: TFile, _data: string, cache: CachedMetadata) => {
          if (
            !this.app.workspace.layoutReady ||
            (cache.tags === undefined && !this.settings.synchronizeRemovals)
          ) {
            return;
          }

          this.debouncer.schedule(file.path, () => {
            this.enqueueSync(file.path, false);
          });
        },
      ),
    );

    this.registerEditorExtension(
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet) {
          return;
        }

        const path = this.app.workspace.getActiveFile()?.path;
        if (path !== undefined) {
          this.debouncer.schedule(path, () => {
            this.enqueueSync(path, false);
          });
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.app.workspace.layoutReady) {
          return;
        }

        const previousPath = this.activeFilePath;
        this.activeFilePath = this.app.workspace.getActiveFile()?.path ?? null;
        if (previousPath !== null && previousPath !== this.activeFilePath) {
          this.debouncer.cancel(previousPath);
          this.enqueueSync(previousPath, true);
        }
      }),
    );
  }

  private async loadSettings(): Promise<void> {
    const storedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(storedSettings as Partial<TagathaSettings> | null),
      tagSnapshots:
        (storedSettings as Partial<TagathaSettings> | null)?.tagSnapshots ?? {},
    };
  }

  private async persistSettings(): Promise<void> {
    const nextSave = this.settingsSaveChain
      .catch(() => undefined)
      .then(async () => {
        await this.saveData(this.settings);
      });
    this.settingsSaveChain = nextSave;
    await nextSave;
  }

  private collectTagSnapshots(): Record<string, TagSnapshot> {
    return Object.fromEntries(
      this.app.vault.getMarkdownFiles().map((file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatterTags = parseFrontMatterTags(cache?.frontmatter) ?? [];
        const inlineTags = cache?.tags?.map((tag) => tag.tag) ?? [];

        return [
          file.path,
          {
            frontmatterTags: mergeTags([], frontmatterTags).tags,
            inlineTags: mergeTags([], inlineTags).tags,
          },
        ];
      }),
    );
  }

  private enqueueSync(path: string, includeTrailingTag: boolean): void {
    const previous = this.syncChains.get(path) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (!this.isUnloading) {
          await this.syncBodyTags(path, includeTrailingTag);
        }
      });

    this.syncChains.set(path, next);

    void next
      .catch((error: unknown) => {
        console.error(`Tagatha could not update tags for ${path}.`, error);
      })
      .finally(() => {
        if (this.syncChains.get(path) === next) {
          this.syncChains.delete(path);
        }
      });
  }

  private async syncBodyTags(
    path: string,
    includeTrailingTag: boolean,
  ): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "md") {
      return;
    }

    const cache = this.app.metadataCache.getFileCache(abstractFile);
    const cachedTags = cache?.tags ?? [];
    const shouldIncludeTrailingTag =
      includeTrailingTag || this.activeFilePath !== path;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editingOffset =
      activeView?.file?.path === path
        ? activeView.editor.posToOffset(activeView.editor.getCursor("head"))
        : null;
    const content =
      activeView?.file?.path === path
        ? activeView.editor.getValue()
        : await this.app.vault.cachedRead(abstractFile);
    if (this.isUnloading) {
      return;
    }

    const stableInlineTags = getStableInlineTagPositions(
      cachedTags,
      content,
      shouldIncludeTrailingTag,
      editingOffset,
    );
    const inlineTags = stableInlineTags.map((tag) => tag.tag);
    const allInlineTags = cachedTags.map((tag) => tag.tag);
    const cachedFrontmatterTags = parseFrontMatterTags(cache?.frontmatter) ?? [];
    const previousSnapshot = this.settings.tagSnapshots[path];
    const removalPlan = this.settings.synchronizeRemovals
      ? getTagRemovalPlan(
          previousSnapshot?.frontmatterTags ?? [],
          previousSnapshot?.inlineTags ?? [],
          cachedFrontmatterTags,
          allInlineTags,
        )
      : { frontmatterTags: [], inlineTags: [] };
    const allInlineTagsToRetain = allInlineTags.filter((tag) => {
      const normalized = normalizeTag(tag);
      return (
        normalized !== null &&
        !hasNormalizedTag(removalPlan.inlineTags, normalized)
      );
    });
    const inlineTagsToRetain = inlineTags.filter((tag) => {
      const normalized = normalizeTag(tag);
      return (
        normalized !== null &&
        !hasNormalizedTag(removalPlan.inlineTags, normalized)
      );
    });
    const cachedUpdate = createTagPropertyUpdate(
      cache?.frontmatter ?? {},
      cachedFrontmatterTags,
      inlineTagsToRetain,
      removalPlan.frontmatterTags,
    );

    if (this.isUnloading) {
      return;
    }

    if (removalPlan.inlineTags.length > 0) {
      await this.app.vault.process(abstractFile, (content) =>
        removeInlineTags(content, cachedTags, removalPlan.inlineTags),
      );
    }

    if (cachedUpdate !== null) {
      await this.app.fileManager.processFrontMatter(
        abstractFile,
        (frontmatter: Record<string, unknown>) => {
          const existingTags = parseFrontMatterTags(frontmatter) ?? [];
          const update = createTagPropertyUpdate(
            frontmatter,
            existingTags,
            inlineTagsToRetain,
            removalPlan.frontmatterTags,
          );
          if (update !== null) {
            frontmatter[update.key] = update.value;
          }
        },
      );
    }

    if (this.settings.synchronizeRemovals) {
      const retainedFrontmatterTags = cachedFrontmatterTags.filter((tag) =>
        !hasNormalizedTag(removalPlan.frontmatterTags, tag),
      );
      this.settings.tagSnapshots[path] = {
        frontmatterTags: mergeTags(
          retainedFrontmatterTags,
          inlineTagsToRetain,
        ).tags,
        inlineTags: mergeTags([], allInlineTagsToRetain).tags,
      };
      await this.persistSettings();
    }
  }
}
