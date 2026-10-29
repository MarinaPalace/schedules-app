import { redirect } from "next/navigation";

// The department schedule now lives in "My schedule" → Table → Whole department.
export default function MyDepartmentPage() {
  redirect("/me?view=table&team=1");
}
