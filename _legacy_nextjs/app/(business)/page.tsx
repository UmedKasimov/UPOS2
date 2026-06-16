import { DashboardFrame } from "@/components/shell/dashboard-frame";

export default function HomePage() {
  return (
    <DashboardFrame
      variant="user"
      title="Главная"
      description="Здесь появится сводка по бизнесу, операциям и интеграциям. Пока раздел пустой — мы закладываем навигацию и оболочку."
    >
      <div className="border-border bg-card text-muted-foreground rounded-xl border border-dashed px-6 py-16 text-center text-sm">
        Контент панели пользователя будет добавлен на следующих этапах.
      </div>
    </DashboardFrame>
  );
}
