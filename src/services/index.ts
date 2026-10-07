// Stub of the app's services module — only what CameraView uses.
const translations: Record<string, string> = {
    fileUploading: 'Uploading file…',
};

export const appService = {
    getTranslations: (key: string): string => translations[key] ?? key,
};
