export function nextReviewLocationId(queue, currentId) {
  if (!Array.isArray(queue) || queue.length < 2) return null;
  const start = queue.findIndex((item) => item.id === currentId);
  const ordered =
    start === -1
      ? [...queue]
      : [...queue.slice(start + 1), ...queue.slice(0, start)];
  return (
    ordered.find(
      (item) => item.id !== currentId && item.reviewNeeded === true
    )?.id || null
  );
}

export function filterReviewQueue(
  queue,
  { search = '', type = '' } = {}
) {
  if (!Array.isArray(queue)) return [];
  const query = String(search).trim().toLocaleLowerCase('zh-Hant');
  return queue.filter((item) => {
    if (type === '__MISSING__' && !item.typeMissing) return false;
    if (type && type !== '__MISSING__' && item.type !== type) return false;
    if (!query) return true;
    return [
      item.name,
      item.nameZh,
      item.alternateName,
      item.slug,
      item.type,
      item.category,
      item.countryCode,
      item.destinationKey,
      ...(Array.isArray(item.sourceTags) ? item.sourceTags : []),
    ]
      .filter(Boolean)
      .some((value) =>
        String(value).toLocaleLowerCase('zh-Hant').includes(query)
      );
  });
}

export function selectionAfterQueueRefresh(
  queue,
  previousId,
  previousIndex
) {
  if (!Array.isArray(queue) || queue.length === 0) return null;
  if (
    previousId &&
    queue.some((item) => item.id === previousId)
  ) {
    return previousId;
  }
  if (!previousId) return null;
  const fallbackIndex = Number.isInteger(previousIndex)
    ? Math.min(Math.max(previousIndex, 0), queue.length - 1)
    : 0;
  return queue[fallbackIndex].id;
}

export function candidatePreviewMatchesLocation(preview, location) {
  if (!preview?.page?.id || !location?.id) return false;
  const previewPageId = String(preview.page.id)
    .replaceAll('-', '')
    .toLowerCase();
  const locationPageId = String(location.id)
    .replaceAll('-', '')
    .toLowerCase();
  const previewRevision = preview.page.recordRevision || null;
  const locationRevision = location.recordRevision || null;
  if (previewRevision || locationRevision) {
    return (
      previewPageId === locationPageId &&
      Boolean(previewRevision) &&
      previewRevision === locationRevision
    );
  }
  return (
    previewPageId === locationPageId &&
    preview.page.name === location.name &&
    preview.page.slug === location.slug &&
    (preview.page.currentPlaceId || null) ===
      (location.currentPlaceId || null) &&
    preview.page.lat === location.lat &&
    preview.page.lng === location.lng
  );
}
