import { icons, Building2, type LucideProps } from "lucide-react";

export function DepartmentIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = (icons as Record<string, React.ComponentType<LucideProps>>)[name] ?? Building2;
  return <Icon {...props} />;
}
