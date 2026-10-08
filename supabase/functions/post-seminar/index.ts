import { createPostSeminarHandler } from "./handler.ts";

const environment=(name:string)=>Deno.env.get(name) ?? "";
let font:Promise<Uint8Array>|undefined;
Deno.serve(createPostSeminarHandler({
  url:environment("SUPABASE_URL"),key:environment("SUPABASE_SERVICE_ROLE_KEY"),secret:environment("POST_SEMINAR_JOB_SECRET"),
  appUrl:environment("APP_URL"),clientId:environment("GMAIL_CLIENT_ID"),clientSecret:environment("GMAIL_CLIENT_SECRET"),
  refreshToken:environment("GMAIL_REFRESH_TOKEN"),sender:environment("GMAIL_SENDER"),
},()=>font ??= Deno.readFile(new URL("./assets/NotoSans-Regular.ttf",import.meta.url))));
