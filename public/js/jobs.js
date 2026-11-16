import {
  apiGet,
  formatDate,
  formatDuration,
  formatNumber,
  formatRelative,
} from "./shared.js";
import { injectShell } from "./shell.js";

const { createApp, onBeforeUnmount, onMounted, reactive, ref } = Vue;

createApp({
  setup() {
    const jobs = ref([]);
    const loading = ref(false);
    const starting = ref(false);
    const error = ref("");

    const status = reactive({
      running: false,
      config: {
        apifyConfigured: false,
        externalActionsEnabled: false,
        fallbackEnabled: false,
        cron: "0 0 * * *",
        timezone: "Asia/Ho_Chi_Minh",
        searchQueries: [],
        resultsPerPage: 0,
      },
      job: null,
    });

    let timer = null;

    function jobStatusClass(value) {
      if (value === "COMPLETED") return "pill-positive";
      if (value === "PARTIAL") return "pill-accent";
      if (value === "FAILED") return "pill-negative";
      if (value === "RUNNING") return "pill-live";
      return "pill-neutral";
    }

    async function loadStatus() {
      try {
        const body = await apiGet("/api/scrape/status");
        status.running = Boolean(body.data.running);
        Object.assign(status.config, body.data.config);
        status.job = body.data.job;
        return body.data.running;
      } catch (err) {
        error.value = err.message ?? String(err);
        return false;
      }
    }

    async function loadJobs() {
      loading.value = true;
      try {
        const body = await apiGet("/api/jobs", { limit: 50 });
        jobs.value = body.data;
      } catch (err) {
        error.value = err.message ?? String(err);
        jobs.value = [];
      } finally {
        loading.value = false;
      }
    }

    async function refresh() {
      error.value = "";
      await Promise.all([loadStatus(), loadJobs()]);
    }

    async function trigger() {
      starting.value = true;
      error.value = "";

      try {
        const response = await fetch("/api/scrape", { method: "POST" });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) {
          throw new Error(body?.error?.message ?? "Không thể khởi chạy phiên cào");
        }
        status.running = true;
        startPolling();
      } catch (err) {
        error.value = err.message ?? String(err);
      } finally {
        starting.value = false;
      }
    }

    function startPolling() {
      clearInterval(timer);
      timer = setInterval(async () => {
        const running = await loadStatus();
        await loadJobs();
        if (!running) {
          clearInterval(timer);
          timer = null;
        }
      }, 4000);
    }

    onMounted(async () => {
      await refresh();
      if (status.running) startPolling();
    });

    onBeforeUnmount(() => clearInterval(timer));

    return {
      jobs,
      loading,
      starting,
      error,
      status,
      refresh,
      trigger,
      jobStatusClass,
      formatNumber,
      formatDate,
      formatDuration,
      formatRelative,
    };
  },
}).mount("#app");

const root = document.getElementById("app");
if (root) injectShell(root);
