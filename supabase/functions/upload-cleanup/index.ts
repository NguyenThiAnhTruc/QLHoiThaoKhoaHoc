import {createUploadCleanupHandler} from "./handler.ts";
Deno.serve(createUploadCleanupHandler({url:Deno.env.get("SUPABASE_URL") ?? "",key:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",secret:Deno.env.get("UPLOAD_CLEANUP_JOB_SECRET") ?? ""}));
