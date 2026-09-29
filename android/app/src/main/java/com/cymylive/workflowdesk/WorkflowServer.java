package com.cymylive.workflowdesk;

import android.content.Context;
import android.util.Log;

import fi.iki.elonen.NanoHTTPD;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 内嵌 HTTP 服务器，把电脑端 server.js 的逻辑移植过来。
 *
 * 提供：
 *   · public/ 目录的静态文件
 *   · /api/* 接口（state / export / import / backups / health）
 *
 * 数据存在 filesDir/data/workflows.json，备份在 filesDir/backups/。
 */
public class WorkflowServer extends NanoHTTPD {

    private static final String TAG = "WorkflowDesk";

    public static final int PORT = 8317;

    private final Context context;
    private final File filesDir;
    private final File dataDir;
    private final File dataFile;
    private final File backupDir;
    private static final int MAX_BACKUPS = 50;

    public WorkflowServer(Context context) {
        super(PORT);
        this.context = context;
        this.filesDir = context.getFilesDir();
        this.dataDir = new File(filesDir, "data");
        this.dataFile = new File(dataDir, "workflows.json");
        this.backupDir = new File(filesDir, "backups");
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();

        try {
            if (uri.startsWith("/api/")) {
                return serveApi(session, uri, method);
            }
            return serveStatic(uri);
        } catch (Exception e) {
            Log.e(TAG, "serve error", e);
            return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"" + escape(e.getMessage()) + "\"}");
        }
    }

    /* ==================== API ==================== */

    private Response serveApi(IHTTPSession session, String uri, Method method) throws Exception {
        if (uri.equals("/api/health") && method == Method.GET) {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("name", "workflow-desk");
            o.put("port", PORT);
            o.put("ips", new JSONArray(NetworkUtils.lanIps()));
            return json(Response.Status.OK, o.toString());
        }

        if (uri.equals("/api/state") && method == Method.GET) {
            return json(Response.Status.OK, readData().toString());
        }

        if (uri.equals("/api/state") && method == Method.PUT) {
            String body = readBody(session);
            JSONObject obj = new JSONObject(body);
            if (!obj.has("workflows") || !(obj.get("workflows") instanceof JSONArray)) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"缺少 workflows 数组\"}");
            }
            saveData(obj);
            return json(Response.Status.OK, "{\"ok\":true}");
        }

        if (uri.equals("/api/export") && method == Method.GET) {
            JSONObject data = readData();
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd-HH-mm-ss", Locale.US);
            String stamp = sdf.format(new Date());
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Disposition", "attachment; filename=\"workflow-backup-" + stamp + ".json\"");
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8",
                    data.toString(2));
        }

        if (uri.equals("/api/import") && method == Method.POST) {
            String body = readBody(session);
            JSONObject obj = new JSONObject(body);
            if (!obj.has("workflows")) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"不是有效的备份文件\"}");
            }
            saveData(obj);
            return json(Response.Status.OK, "{\"ok\":true}");
        }

        if (uri.equals("/api/backups") && method == Method.GET) {
            JSONArray arr = new JSONArray();
            File[] files = backupDir.listFiles();
            if (files != null) {
                Arrays.sort(files, (a, b) -> b.getName().compareTo(a.getName()));
                int n = 0;
                for (File f : files) {
                    if (!f.getName().endsWith(".json")) continue;
                    if (n++ >= 50) break;
                    JSONObject o = new JSONObject();
                    o.put("file", f.getName());
                    o.put("size", f.length());
                    arr.put(o);
                }
            }
            JSONObject out = new JSONObject();
            out.put("backups", arr);
            return json(Response.Status.OK, out.toString());
        }

        if (uri.equals("/api/backups/restore") && method == Method.POST) {
            String body = readBody(session);
            JSONObject req = new JSONObject(body);
            String file = req.optString("file", "");
            if (!file.matches("^[A-Za-z0-9._-]+\\.json$")) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"文件名不合法\"}");
            }
            File src = new File(backupDir, file);
            if (!src.exists()) {
                return json(Response.Status.NOT_FOUND, "{\"error\":\"备份不存在\"}");
            }
            JSONObject data = new JSONObject(readText(src));
            saveData(data);
            return json(Response.Status.OK, "{\"ok\":true}");
        }

        if (uri.equals("/api/reset") && method == Method.POST) {
            saveData(emptyState());
            return json(Response.Status.OK, "{\"ok\":true}");
        }

        return json(Response.Status.NOT_FOUND, "{\"error\":\"接口不存在\"}");
    }

    /* ==================== 静态文件 ==================== */

    private Response serveStatic(String uri) throws IOException {
        if (uri.equals("/") || uri.isEmpty()) uri = "/index.html";

        // 去掉查询串，防止路径穿越
        String path = uri.replace("..", "").replace("//", "/");
        if (path.startsWith("/")) path = path.substring(1);

        // 先从 assets 里找（打包进去的前端），找不到再从 filesDir 找
        byte[] bytes = readAsset(path);
        if (bytes == null) {
            File f = new File(filesDir, path);
            if (f.exists() && f.isFile()) {
                bytes = readAllBytes(new FileInputStream(f));
            }
        }
        if (bytes == null) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not Found");
        }
        return newFixedLengthResponse(Response.Status.OK, mimeOf(path), new ByteArrayInputStream(bytes), bytes.length);
    }

    private byte[] readAsset(String path) {
        try {
            InputStream is = context.getAssets().open("public/" + path);
            byte[] b = readAllBytes(is);
            is.close();
            return b;
        } catch (IOException e) {
            return null;
        }
    }

    /* ==================== 数据读写 ==================== */

    private JSONObject readData() {
        try {
            if (!dataFile.exists()) {
                JSONObject demo = demoState();
                saveData(demo);
                return demo;
            }
            return new JSONObject(readText(dataFile));
        } catch (Exception e) {
            Log.e(TAG, "readData error", e);
            return emptyState();
        }
    }

    private void saveData(JSONObject data) {
        try {
            dataDir.mkdirs();
            if (dataFile.exists()) {
                backupDir.mkdirs();
                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss-SSS'Z'", Locale.US);
                File bk = new File(backupDir, "workflows-" + sdf.format(new Date()) + ".json");
                copyFile(dataFile, bk);
                pruneBackups();
            }
            data.put("updatedAt", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(new Date()));
            File tmp = new File(dataDir, "workflows.json.tmp");
            try (FileOutputStream fos = new FileOutputStream(tmp)) {
                fos.write(data.toString(2).getBytes(StandardCharsets.UTF_8));
            }
            if (dataFile.exists()) dataFile.delete();
            tmp.renameTo(dataFile);
        } catch (Exception e) {
            Log.e(TAG, "saveData error", e);
        }
    }

    private void pruneBackups() {
        File[] files = backupDir.listFiles();
        if (files == null) return;
        List<File> list = new ArrayList<>();
        for (File f : files) if (f.getName().endsWith(".json")) list.add(f);
        if (list.size() <= MAX_BACKUPS) return;
        Collections.sort(list, (a, b) -> a.getName().compareTo(b.getName()));
        for (int i = 0; i < list.size() - MAX_BACKUPS; i++) list.get(i).delete();
    }

    private JSONObject emptyState() {
        try {
            JSONObject o = new JSONObject();
            o.put("schema", "workflow-desk");
            o.put("version", 1);
            String now = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(new Date());
            o.put("createdAt", now);
            o.put("updatedAt", now);
            o.put("workflows", new JSONArray());
            return o;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private JSONObject demoState() {
        try {
            JSONObject o = emptyState();
            JSONArray arr = new JSONArray();
            JSONObject w = new JSONObject();
            w.put("id", randId());
            w.put("name", "让生活幸福的工作流");
            w.put("version", "1.0.0");
            w.put("goal", "每天执行固定的小环节，稳定提升身体、情绪、关系三个维度的满意度。");
            w.put("status", "developing");
            w.put("pinned", false);
            String now = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(new Date());
            w.put("createdAt", now);
            w.put("updatedAt", now);
            w.put("tags", new JSONArray(Arrays.asList("生活", "幸福感")));
            JSONArray steps = new JSONArray();
            String[][] ss = {
                {"晨间启动", "起床后 10 分钟固定动作：喝水、拉伸、写下今天最重要的一件事。", "不要一睁眼就看手机。"},
                {"身体充电", "20 分钟运动或快走。", "下雨天改成室内拉伸。"},
                {"深度工作块", "90 分钟无干扰专注。", "用番茄钟 25+5 循环三轮。"},
            };
            for (String[] s : ss) {
                JSONObject st = new JSONObject();
                st.put("id", randId());
                st.put("title", s[0]);
                st.put("desc", s[1]);
                st.put("note", s[2]);
                st.put("status", "pending");
                steps.put(st);
            }
            w.put("steps", steps);
            arr.put(w);
            o.put("workflows", arr);
            return o;
        } catch (Exception e) {
            return emptyState();
        }
    }

    /* ==================== 工具 ==================== */

    private String readBody(IHTTPSession session) throws IOException, ResponseException {
        Map<String, String> body = new HashMap<>();
        session.parseBody(body);
        String post = body.get("postData");
        return post != null ? post : "";
    }

    private static String readText(File f) throws IOException {
        return new String(readAllBytes(new FileInputStream(f)), StandardCharsets.UTF_8);
    }

    private static byte[] readAllBytes(InputStream is) throws IOException {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static void copyFile(File src, File dst) throws IOException {
        try (FileInputStream in = new FileInputStream(src);
             FileOutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    private static String randId() {
        StringBuilder sb = new StringBuilder();
        java.util.Random r = new java.util.Random();
        for (int i = 0; i < 16; i++) sb.append(Integer.toHexString(r.nextInt(16)));
        return sb.toString();
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static Response json(Response.Status status, String body) {
        return newFixedLengthResponse(status, "application/json; charset=utf-8", body);
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }
}
