import { SettingsTabs } from "@/components/settings/settings-tabs";
import { DashboardFrame } from "@/components/shell/dashboard-frame";

export default function AdminSettingsPage() {
  return (
    <DashboardFrame
      variant="admin"
      title="Настройки"
      description="Параметры административного интерфейса и интеграций."
    >
      <SettingsTabs context="admin" />
    </DashboardFrame>
  );
}
