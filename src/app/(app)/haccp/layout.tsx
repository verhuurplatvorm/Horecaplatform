import { TouchArea } from "@/components/touch/touch-keyboard";

// Keukenschermen: touchscherm-modus met schermtoetsenbord (aan/uit per apparaat).
export default function TouchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TouchArea>{children}</TouchArea>;
}
