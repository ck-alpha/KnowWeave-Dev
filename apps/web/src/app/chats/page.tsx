export default function ChatsIndexPage() {
  return (
    <main className="flex h-full items-center justify-center px-6 py-10">
      <div className="max-w-md text-center text-sm text-muted-foreground">
        <p className="text-lg font-medium text-foreground">Start a conversation</p>
        <p className="mt-2">
          从左侧选择会话，或点击 <strong>+ 新建会话</strong> 开始提问。窄屏可先打开会话列表。
        </p>
      </div>
    </main>
  );
}
