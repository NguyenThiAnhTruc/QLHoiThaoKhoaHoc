import {Component,type ReactNode} from 'react';
export class AppErrorBoundary extends Component<{children:ReactNode},{failed:boolean;reference:string}>{
 state={failed:false,reference:''};
 static getDerivedStateFromError(){return {failed:true,reference:crypto.randomUUID()};}
 componentDidCatch(){
  // Record a reference only; user data, tokens and form contents are not logged.
  console.error('Application render failed. Reference:',this.state.reference);
 }
 render(){
  if(this.state.failed)return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div role="alert" className="max-w-lg space-y-4 rounded-xl bg-white p-6 shadow"><h1 className="text-xl font-semibold">Không thể hiển thị trang</h1><p>Vui lòng tải lại trang. Nếu lỗi lặp lại, gửi mã bên dưới cho quản trị viên.</p><p className="break-all text-sm text-slate-500">Mã lỗi: {this.state.reference}</p><button className="rounded-lg bg-teal-700 px-4 py-2 text-white" onClick={()=>window.location.reload()}>Tải lại trang</button></div></main>;
  return this.props.children;
 }
}
