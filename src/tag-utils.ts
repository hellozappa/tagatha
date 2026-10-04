export interface TagMergeResult {
  tags: string[];
  added: string[];
}

export interface TagPropertyUpdate {
  key: string;
  value: unknown[];
}

export interface TagRemovalPlan {
  frontmatterTags: string[];
  inlineTags: string[];
}

export interface PositionedInlineTag {
  tag: string;
  position: {
    start: {
      offset: number;
    };
    end: {
      offset: number;
    };
  };
}

export function normalizeTag(tag: string): string | null {
  const normalized = tag.trim().replace(/^#+/, "");
  return normalized.length > 0 ? normalized : null;
}

export function hasNormalizedTag(
  tags: readonly string[],
  candidate: string,
): boolean {
  const normalizedCandidate = normalizeTag(candidate);
  if (normalizedCandidate === null) {
    return false;
  }

  return tags.some((tag) => {
    const normalizedTag = normalizeTag(tag);
    return (
      normalizedTag !== null &&
      normalizedTag.toLowerCase() === normalizedCandidate.toLowerCase()
    );
  });
}

export function mergeTags(
  existingTags: readonly string[],
  inlineTags: readonly string[],
): TagMergeResult {
  const tags: string[] = [];
  const added: string[] = [];
  const seen = new Set<string>();

  for (const tag of existingTags) {
    const normalized = normalizeTag(tag);
    if (normalized === null) {
      continue;
    }

    tags.push(normalized);
    seen.add(normalized.toLowerCase());
  }

  for (const tag of inlineTags) {
    const normalized = normalizeTag(tag);
    if (normalized === null) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(normalized);
    added.push(normalized);
  }

  return { tags, added };
}

export function createTagPropertyUpdate(
  frontmatter: Record<string, unknown>,
  existingTags: readonly string[],
  inlineTags: readonly string[],
  removedTags: readonly string[],
): TagPropertyUpdate | null {
  const merge = mergeTags(existingTags, inlineTags);
  const key =
    Object.keys(frontmatter).find(
      (frontmatterKey) => frontmatterKey.toLowerCase() === "tags",
    ) ?? "tags";
  const currentValue = frontmatter[key];
  const currentValues = Array.isArray(currentValue)
    ? [...currentValue]
    : currentValue === undefined || currentValue === null
      ? []
      : [currentValue];
  const removedKeys = new Set(
    removedTags
      .map(normalizeTag)
      .filter((tag): tag is string => tag !== null)
      .map((tag) => tag.toLowerCase()),
  );
  const retainedValues = currentValues.filter((value) => {
    if (typeof value !== "string") {
      return true;
    }

    const normalized = normalizeTag(value);
    return normalized === null || !removedKeys.has(normalized.toLowerCase());
  });
  const didRemoveTags = retainedValues.length !== currentValues.length;
  if (merge.added.length === 0 && !didRemoveTags) {
    return null;
  }

  return {
    key,
    value: [...retainedValues, ...merge.added],
  };
}

export function getTagRemovalPlan(
  previousFrontmatterTags: readonly string[],
  previousInlineTags: readonly string[],
  frontmatterTags: readonly string[],
  inlineTags: readonly string[],
): TagRemovalPlan {
  const frontmatterKeys = new Set(
    frontmatterTags
      .map(normalizeTag)
      .filter((tag): tag is string => tag !== null)
      .map((tag) => tag.toLowerCase()),
  );
  const inlineKeys = new Set(
    inlineTags
      .map(normalizeTag)
      .filter((tag): tag is string => tag !== null)
      .map((tag) => tag.toLowerCase()),
  );
  const previousFrontmatterKeys = new Set(
    previousFrontmatterTags
      .map(normalizeTag)
      .filter((tag): tag is string => tag !== null)
      .map((tag) => tag.toLowerCase()),
  );
  const previousInlineKeys = new Set(
    previousInlineTags
      .map(normalizeTag)
      .filter((tag): tag is string => tag !== null)
      .map((tag) => tag.toLowerCase()),
  );
  const frontmatterTagsToRemove: string[] = [];
  const inlineTagsToRemove: string[] = [];

  for (const key of previousFrontmatterKeys) {
    if (!previousInlineKeys.has(key)) {
      continue;
    }

    if (!inlineKeys.has(key) && frontmatterKeys.has(key)) {
      frontmatterTagsToRemove.push(key);
    } else if (inlineKeys.has(key) && !frontmatterKeys.has(key)) {
      inlineTagsToRemove.push(key);
    }
  }

  return {
    frontmatterTags: [...new Set(frontmatterTagsToRemove)],
    inlineTags: [...new Set(inlineTagsToRemove)],
  };
}

export function removeInlineTags(
  content: string,
  inlineTags: readonly PositionedInlineTag[],
  removedTags: readonly string[],
): string {
  const removedKeys = new Set(
    removedTags
      .map(normalizeTag)
      .filter((tag): tag is string => tag !== null)
      .map((tag) => tag.toLowerCase()),
  );
  const ranges = inlineTags
    .filter((tag) => {
      const normalized = normalizeTag(tag.tag);
      return normalized !== null && removedKeys.has(normalized.toLowerCase());
    })
    .map((tag) => tag.position)
    .sort((left, right) => right.start.offset - left.start.offset);

  return ranges.reduce(
    (updatedContent, range) =>
      updatedContent.slice(0, range.start.offset) +
      updatedContent.slice(range.end.offset),
    content,
  );
}

export function getStableInlineTags(
  tags: readonly PositionedInlineTag[],
  content: string,
  includeTrailingTag: boolean,
  editingOffset: number | null,
): string[] {
  return getStableInlineTagPositions(
    tags,
    content,
    includeTrailingTag,
    editingOffset,
  ).map((tag) => tag.tag);
}

export function getStableInlineTagPositions(
  tags: readonly PositionedInlineTag[],
  content: string,
  includeTrailingTag: boolean,
  editingOffset: number | null,
): PositionedInlineTag[] {
  return tags.filter((tag) => {
    const startOffset = tag.position.start.offset;
    const endOffset = tag.position.end.offset;
    if (content.slice(startOffset, endOffset) !== tag.tag) {
      return false;
    }

    if (includeTrailingTag) {
      return true;
    }

    const followingCharacter = content.charAt(endOffset);
    if (!/[ \t\r\n]/.test(followingCharacter)) {
      return false;
    }

    return (
      editingOffset === null ||
      editingOffset < startOffset ||
      editingOffset > endOffset
    );
  });
}
