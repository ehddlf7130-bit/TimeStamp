export interface NamedBlob { name: string; blob: Blob }

export function canShareFiles(files: File[]): boolean {
  try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files }); }
  catch { return false; }
}

/**
 * Opens the share sheet (iPhone: "이미지 저장" saves to Photos).
 * Returns false if the user cancelled, throws if sharing files is unsupported.
 */
export async function shareFiles(items: NamedBlob[]): Promise<boolean> {
  const files = items.map((i) => new File([i.blob], i.name, { type: i.blob.type }));
  if (!canShareFiles(files)) throw new Error('이 브라우저는 사진 공유를 지원하지 않습니다. 사진별 이미지 다운로드를 이용해 주세요.');
  try {
    await navigator.share({ files });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
