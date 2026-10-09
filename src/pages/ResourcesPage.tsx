import { ResourceCenter } from "@/components/ResourceCenter";
import { useRouter } from "@/context/useRouter";
export function ResourcesPage(){
  const {route}=useRouter();
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold">Kho tài liệu</h1><p className="mt-1 text-sm text-slate-500">Slide, tài liệu đọc thêm và kỷ yếu theo hội thảo.</p></header><ResourceCenter conferenceId={route.params.conferenceId} /></div>;
}
