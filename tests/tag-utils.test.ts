import { describe, expect, it } from "vitest";

import {
  createTagPropertyUpdate,
  getTagRemovalPlan,
  getStableInlineTags,
  hasNormalizedTag,
  mergeTags,
  normalizeTag,
  removeInlineTags,
} from "../src/tag-utils";

describe("normalizeTag", () => {
  it("removes the inline hash prefix", () => {
    expect(normalizeTag("#financial")).toBe("financial");
    expect(normalizeTag(" #client/billing ")).toBe("client/billing");
  });

  it("rejects empty tag values", () => {
    expect(normalizeTag("#")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });

  it("matches tags independently of hashes and casing", () => {
    expect(hasNormalizedTag(["financial"], "#FINANCIAL")).toBe(true);
  });
});

describe("getStableInlineTags", () => {
  const trailingTag = {
    tag: "#financial",
    position: { start: { offset: 0 }, end: { offset: 10 } },
  };

  it("defers a tag that is still at the active editor boundary", () => {
    expect(getStableInlineTags([trailingTag], "#financial ", false, 10)).toEqual([]);
  });

  it("includes a tag after the user types a boundary character", () => {
    expect(getStableInlineTags([trailingTag], "#financial ", false, 11)).toEqual([
      "#financial",
    ]);
  });

  it.each([" ", "\t", "\n", "\r\n"])(
    "includes a completed tag after delimiter %j",
    (delimiter) => {
      const content = `#financial${delimiter}`;
      expect(
        getStableInlineTags([trailingTag], content, false, content.length),
      ).toEqual(["#financial"]);
    },
  );

  it("does not sync a stale cached prefix while the live tag is growing", () => {
    const cachedPrefix = {
      tag: "#fin",
      position: { start: { offset: 0 }, end: { offset: 4 } },
    };
    expect(
      getStableInlineTags([cachedPrefix], "#financial", false, 10),
    ).toEqual([]);
    expect(
      getStableInlineTags([cachedPrefix], "#financial ", false, 11),
    ).toEqual([]);
  });

  it("does not sync a tag merely because the cursor moved away", () => {
    const unfinishedTag = {
      tag: "#financial",
      position: { start: { offset: 6 }, end: { offset: 16 } },
    };
    expect(
      getStableInlineTags([unfinishedTag], "Text: #financial", false, 0),
    ).toEqual([]);
  });

  it("rejects cached offsets that no longer match the live document", () => {
    expect(
      getStableInlineTags([trailingTag], "Text: #financial ", false, 17),
    ).toEqual([]);
  });

  it("syncs a completed tag while deferring a new tag on the same line", () => {
    const completedTag = {
      tag: "#work",
      position: { start: { offset: 0 }, end: { offset: 5 } },
    };
    const newTag = {
      tag: "#financial",
      position: { start: { offset: 6 }, end: { offset: 16 } },
    };
    expect(
      getStableInlineTags(
        [completedTag, newTag],
        "#work #financial",
        false,
        16,
      ),
    ).toEqual(["#work"]);
  });

  it("includes a trailing tag when the user leaves the note", () => {
    expect(getStableInlineTags([trailingTag], "#financial", true, null)).toEqual([
      "#financial",
    ]);
  });

  it("uses the document boundary when no editor cursor is available", () => {
    expect(getStableInlineTags([trailingTag], "#financial", false, null)).toEqual([]);
    expect(getStableInlineTags([trailingTag], "#financial ", false, null)).toEqual([
      "#financial",
    ]);
  });
});

describe("mergeTags", () => {
  it("appends inline tags while preserving existing tag order", () => {
    expect(
      mergeTags(["client-work"], ["#financial", "#client/billing"]),
    ).toEqual({
      tags: ["client-work", "financial", "client/billing"],
      added: ["financial", "client/billing"],
    });
  });

  it("deduplicates tags case-insensitively", () => {
    expect(mergeTags(["Financial"], ["#financial", "#FINANCIAL"])).toEqual({
      tags: ["Financial"],
      added: [],
    });
  });

  it("does not rewrite repeated existing tags while deduplicating additions", () => {
    expect(
      mergeTags(["financial", "financial"], ["#client", "#client"]),
    ).toEqual({
      tags: ["financial", "financial", "client"],
      added: ["client"],
    });
  });
});

describe("createTagPropertyUpdate", () => {
  it("preserves the casing and raw values of an existing Tags property", () => {
    const frontmatter = { Tags: ["Writing", 42] };

    expect(
      createTagPropertyUpdate(frontmatter, ["Writing"], ["#financial"], []),
    ).toEqual({
      key: "Tags",
      value: ["Writing", 42, "financial"],
    });
  });

  it("creates a lowercase tags property when none exists", () => {
    expect(createTagPropertyUpdate({}, [], ["#financial"], [])).toEqual({
      key: "tags",
      value: ["financial"],
    });
  });

  it("does not rewrite the property when every inline tag already exists", () => {
    expect(
      createTagPropertyUpdate(
        { tags: ["Financial"] },
        ["Financial"],
        ["#financial"],
        [],
      ),
    ).toBeNull();
  });

  it("removes matching tags while retaining non-tag values", () => {
    expect(
      createTagPropertyUpdate(
        { Tags: ["Writing", 42, "#financial"] },
        ["Writing", "financial"],
        [],
        ["financial"],
      ),
    ).toEqual({
      key: "Tags",
      value: ["Writing", 42],
    });
  });
});

describe("getTagRemovalPlan", () => {
  it("removes the frontmatter tag after its inline tag is removed", () => {
    expect(
      getTagRemovalPlan(
        ["financial"],
        ["financial"],
        ["financial"],
        [],
      ),
    ).toEqual({ frontmatterTags: ["financial"], inlineTags: [] });
  });

  it("removes the inline tag after its frontmatter tag is removed", () => {
    expect(
      getTagRemovalPlan(["financial"], ["financial"], [], ["#financial"]),
    ).toEqual({ frontmatterTags: [], inlineTags: ["financial"] });
  });

  it("does not infer removals for tags absent from the previous snapshot", () => {
    expect(getTagRemovalPlan([], [], [], ["#financial"])).toEqual({
      frontmatterTags: [],
      inlineTags: [],
    });
  });

  it("does not propagate a mismatch that existed before synchronization", () => {
    expect(
      getTagRemovalPlan(["financial"], [], ["financial"], []),
    ).toEqual({ frontmatterTags: [], inlineTags: [] });
  });
});

describe("removeInlineTags", () => {
  it("removes every matching inline tag from the end of the document first", () => {
    const content = "#financial and #client/billing and #financial";
    const inlineTags = [
      {
        tag: "#financial",
        position: { start: { offset: 0 }, end: { offset: 10 } },
      },
      {
        tag: "#client/billing",
        position: { start: { offset: 15 }, end: { offset: 30 } },
      },
      {
        tag: "#financial",
        position: { start: { offset: 35 }, end: { offset: 45 } },
      },
    ];

    expect(removeInlineTags(content, inlineTags, ["financial"])).toBe(
      " and #client/billing and ",
    );
  });
});
