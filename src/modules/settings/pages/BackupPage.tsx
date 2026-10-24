import { DatabaseBackup } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function BackupPage() {
  return (
    <PagePlaceholder
      icon={DatabaseBackup}
      title="Backup e restauração"
      description="Cópias do banco de dados e dos anexos."
      message="Aqui você vai gerar backups, ver os automáticos e restaurar uma cópia anterior."
    />
  );
}
