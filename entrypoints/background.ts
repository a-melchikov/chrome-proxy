function initialize(): Promise<void> {
  return Promise.resolve();
}

export default defineBackground(() => {
  void initialize().catch(() => {
    console.error('Background initialization failed');
  });
});
