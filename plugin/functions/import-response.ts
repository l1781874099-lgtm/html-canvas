export function localImportResponse(raw: any, requestId: string | null) {
  const message = raw && raw.pluginMessage;
  if (!requestId || !message || message.requestId !== requestId) return null;
  return ['doneLoading', 'importFailed', 'importProgress'].includes(message.type) ? message : null;
}
