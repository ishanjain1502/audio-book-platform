import { describe, expect, it } from "vitest";
import { splitDeliveryTags } from "@/lib/annotate/deliveryTags";

describe("splitDeliveryTags", () => {
  it("marks bracket tags, paired tags, and the words around them", () => {
    expect(splitDeliveryTags("Say [pause] then [measured] <slow>word</slow>.")).toEqual([
      { kind: "text", value: "Say " },
      { kind: "tag", value: "[pause]" },
      { kind: "text", value: " then " },
      { kind: "tag", value: "[measured]" },
      { kind: "text", value: " " },
      { kind: "tag", value: "<slow>word</slow>" },
      { kind: "text", value: "." },
    ]);
  });

  it("leaves an unclosed paired tag as text", () => {
    expect(splitDeliveryTags("Keep <slow> going")).toEqual([
      { kind: "text", value: "Keep <slow> going" },
    ]);
  });
});
