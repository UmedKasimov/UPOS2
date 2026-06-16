import { DashboardFrame } from "@/components/shell/dashboard-frame";

export default function AdminHomePage() {
  return (
    <DashboardFrame
      variant="admin"
      title="Обзор"
      description="Административная зона для управления пользователями, интеграциями и политиками доступа. Раздел пока пустой."
    >
      <div className="border-border bg-card text-muted-foreground rounded-xl border border-dashed px-6 py-16 text-center text-sm">
        Контент админ-панели будет добавлен позже.
      </div>
    </DashboardFrame>
  );
}
