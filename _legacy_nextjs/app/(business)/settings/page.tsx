import { SettingsTabs } from "@/components/settings/settings-tabs";
import { DashboardFrame } from "@/components/shell/dashboard-frame";

export default function UserSettingsPage() {
  return (
    <DashboardFrame
      variant="user"
      title="Настройки"
      description="Параметры рабочего места, уведомлений и интеграций."
    >
      <SettingsTabs context="user" />
    </DashboardFrame>
  );
}
