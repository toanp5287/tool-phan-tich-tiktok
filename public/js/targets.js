import {
  formatDate,
  formatNumber,
} from './shared.js';
import { injectShell } from './shell.js';

const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    const targets = ref([]);
    const categoryOptions = ref([]);
    const loading = ref(true);
    const error = ref('');
    const successMsg = ref('');
    const search = ref('');
    const categoryFilter = ref('');
    const priorityFilter = ref('');
    const activeFilter = ref('');

    // Profile Scrape status & trigger
    const scrapeStatus = ref({ running: false, config: {} });
    const triggeringScrape = ref(false);

    // Modal Add / Edit
    const showModal = ref(false);
    const isEditing = ref(false);
    const editingId = ref(null);
    const form = ref({
      username: '',
      displayName: '',
      category: '',
      priority: 'TOP10',
      note: '',
      isActive: true,
      maxItems: '',
    });
    const submitting = ref(false);

    // Fetch Target Shops
    async function fetchTargets() {
      loading.value = true;
      error.value = '';
      try {
        const params = new URLSearchParams({ pageSize: '100' });
        if (categoryFilter.value) params.append('category', categoryFilter.value);
        if (priorityFilter.value) params.append('priority', priorityFilter.value);
        if (activeFilter.value !== '') params.append('isActive', activeFilter.value);

        const all = [];
        for (let page = 1, totalPages = 1; page <= totalPages; page++) {
          params.set('page', String(page));
          const res = await fetch(`/api/targets?${params.toString()}`);
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error?.message || 'Lỗi khi tải danh sách');
          all.push(...(data.data || []));
          totalPages = data.pagination?.totalPages ?? 1;
        }
        targets.value = all;
        categoryOptions.value = [...new Set([...categoryOptions.value, ...all.map(t => t.category).filter(Boolean)])].sort();
      } catch (err) {
        error.value = err.message;
      } finally {
        loading.value = false;
      }
    }

    // Fetch Profile Scrape Status
    async function fetchScrapeStatus() {
      try {
        const res = await fetch('/api/scrape/profile-status');
        const data = await res.json();
        if (data.success) {
          scrapeStatus.value = data.data;
        }
      } catch (err) {
        console.error('Lỗi lấy status:', err);
      }
    }

    // Trigger Top Shop Scrape
    async function triggerScrape() {
      if (scrapeStatus.value.running || triggeringScrape.value) return;
      triggeringScrape.value = true;
      successMsg.value = '';
      error.value = '';
      try {
        const res = await fetch('/api/scrape/run-top-shops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            priority: priorityFilter.value || undefined,
            category: categoryFilter.value || undefined,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error?.message || 'Không thể kích hoạt cào');
        successMsg.value = data.data?.message || 'Đã kích hoạt cào Top Shop thành công!';
        fetchScrapeStatus();
      } catch (err) {
        error.value = err.message;
      } finally {
        triggeringScrape.value = false;
      }
    }

    // Toggle Active Status
    async function toggleStatus(item) {
      try {
        const res = await fetch(`/api/targets/${item.id}/toggle`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !item.isActive }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error?.message || 'Cập nhật thất bại');
        item.isActive = !item.isActive;
      } catch (err) {
        alert(err.message);
      }
    }

    // Open Modal Create
    function openCreateModal() {
      isEditing.value = false;
      editingId.value = null;
      form.value = {
        username: '',
        displayName: '',
        category: '',
        priority: 'TOP10',
        note: '',
        isActive: true,
        maxItems: '',
      };
      showModal.value = true;
    }

    // Open Modal Edit
    function openEditModal(item) {
      isEditing.value = true;
      editingId.value = item.id;
      form.value = {
        username: item.username,
        displayName: item.displayName || '',
        category: item.category || '',
        priority: item.priority || 'TOP10',
        note: item.note || '',
        isActive: item.isActive,
        maxItems: item.scrapeConfig?.maxItems || '',
      };
      showModal.value = true;
    }

    // Save Target Shop
    async function saveTarget() {
      submitting.value = true;
      error.value = '';
      try {
        const payload = {
          displayName: form.value.displayName.trim() || null,
          category: form.value.category.trim() || null,
          priority: form.value.priority,
          note: form.value.note.trim() || null,
          isActive: form.value.isActive,
        };

        if (form.value.maxItems) {
          if (!/^[1-9][0-9]*$/.test(String(form.value.maxItems))) throw new Error('Số lượng tối đa phải là số nguyên dương');
          payload.scrapeConfig = {
            maxItems: Number(form.value.maxItems),
          };
        } else payload.scrapeConfig = null;

        if (isEditing.value) {
          const res = await fetch(`/api/targets/${editingId.value}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error?.message || 'Cập nhật thất bại');
        } else {
          payload.username = form.value.username.trim();
          const res = await fetch('/api/targets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error?.message || 'Tạo mới thất bại');
        }

        showModal.value = false;
        await fetchTargets();
      } catch (err) {
        alert(err.message);
      } finally {
        submitting.value = false;
      }
    }

    // Delete Target
    async function deleteItem(item) {
      if (!confirm(`Bạn có chắc muốn xoá shop "@${item.username}" khỏi danh sách Top Shop?`)) return;
      try {
        const res = await fetch(`/api/targets/${item.id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error?.message || 'Xoá thất bại');
        targets.value = targets.value.filter((t) => t.id !== item.id);
      } catch (err) {
        alert(err.message);
      }
    }

    // Filtered list
    const filteredTargets = computed(() => {
      let list = targets.value;
      if (search.value.trim()) {
        const q = search.value.toLowerCase().trim();
        list = list.filter(
          (t) =>
            t.username.toLowerCase().includes(q) ||
            (t.displayName && t.displayName.toLowerCase().includes(q)) ||
            (t.category && t.category.toLowerCase().includes(q)),
        );
      }
      return list;
    });

    // Categories list for filter dropdown
    const availableCategories = computed(() => {
      return categoryOptions.value;
    });

    // KPI Counters
    const kpiTotal = computed(() => targets.value.length);
    const kpiActive = computed(() => targets.value.filter((t) => t.isActive).length);
    const kpiTop10 = computed(() => targets.value.filter((t) => t.priority === 'TOP10').length);
    const kpiTop50 = computed(() => targets.value.filter((t) => t.priority === 'TOP50').length);

    onMounted(() => {
      fetchTargets();
      fetchScrapeStatus();
      setInterval(fetchScrapeStatus, 15000);
    });

    return {
      targets,
      filteredTargets,
      availableCategories,
      loading,
      error,
      successMsg,
      search,
      categoryFilter,
      priorityFilter,
      activeFilter,
      scrapeStatus,
      triggeringScrape,
      showModal,
      isEditing,
      form,
      submitting,
      kpiTotal,
      kpiActive,
      kpiTop10,
      kpiTop50,
      fetchTargets,
      triggerScrape,
      toggleStatus,
      openCreateModal,
      openEditModal,
      saveTarget,
      deleteItem,
      formatDate,
      formatNumber,
    };
  },
}).mount('#app');

const root = document.getElementById('app');
if (root) injectShell(root);
