import { redirect } from "next/navigation";

/**
 * Het importscherm doet zowel Gerechten als Halfproducten, maar zat op
 * een URL met "halfproducten" erin — verwarrend als je vanuit Recepten
 * op "Importeren" klikt. Verhuisd naar /recepten/importeren; deze route
 * blijft bestaan zodat oude links en bladwijzers blijven werken.
 */
export default function HalfproductenImportRedirect() {
  redirect("/recepten/importeren");
}
