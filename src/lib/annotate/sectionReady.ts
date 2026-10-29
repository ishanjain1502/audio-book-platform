export function sectionIsComplete(paragraphCount: number, segmentCount: number): boolean {
  return paragraphCount > 0 && segmentCount === paragraphCount;
}

export function firstIncompleteSection(
  sections: { idx: number; paragraphCount: number; segmentCount: number }[],
): number | null {
  const found = sections.find(
    (section) => !sectionIsComplete(section.paragraphCount, section.segmentCount),
  );
  return found ? found.idx + 1 : null;
}
