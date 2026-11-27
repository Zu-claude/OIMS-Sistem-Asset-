import type { Lang, ModuleKey } from '../types/oims';

export const translations: Record<Lang, {
  brandSubtitle: string;
  roadmapTag: string;
  vision: string;
  nav: Record<ModuleKey, string>;
  topbar: {
    searchPlaceholder: string;
    notifications: string;
    noNotifications: string;
    logout: string;
    role: string;
    accountSettings: string;
    themeLight: string;
    themeDark: string;
    toggleTheme: string;
  };
  common: {
    save: string;
    cancel: string;
    confirm: string;
    delete: string;
    edit: string;
    view: string;
    add: string;
    search: string;
    filter: string;
    reset: string;
    exportExcel: string;
    exportPdf: string;
    importData: string;
    print: string;
    loading: string;
    noData: string;
    actions: string;
    status: string;
    condition: string;
    all: string;
  };
  conditions: Record<string, string>;
  dashboard: {
    title: string;
    subtitle: string;
    totalAssets: string;
    totalValue: string;
    goodCondition: string;
    minorDamage: string;
    majorDamage: string;
    unserviceable: string;
    inMaintenance: string;
    missingPic: string;
    missingQr: string;
    recentMovements: string;
    alertsTitle: string;
    chartCategory: string;
    chartLocation: string;
    chartCondition: string;
    chartAcquisition: string;
    chartMaintenance: string;
    chartMovement: string;
    chartLifecycle: string;
    chartLifecycleDesc: string;
    quickActionsTitle: string;
    quickActions: {
      scanQr: string;
      scanQrDesc: string;
      newRegistration: string;
      newRegistrationDesc: string;
      generateReport: string;
      generateReportDesc: string;
      stockOpname: string;
      stockOpnameDesc: string;
    };
  };
  auth: {
    loginTitle: string;
    setupTitle: string;
    setupDesc: string;
    usernameOrEmail: string;
    password: string;
    signIn: string;
    createAdminBtn: string;
    seedRolesOption: string;
    fullName: string;
    username: string;
    email: string;
    forgotPassword: string;
    forgotPasswordTitle: string;
    forgotPasswordDesc: string;
    sendResetCodeBtn: string;
    verifyCodeBtn: string;
    resetPasswordBtn: string;
    verificationCode: string;
    newPassword: string;
    confirmNewPassword: string;
    backToLogin: string;
    resendCode: string;
  };
}> = {
  en: {
    brandSubtitle: 'Member of Indika Energy Group',
    roadmapTag: 'Digitalization 2027–2031',
    vision: 'One Asset · One Identity · One Database',
    nav: {
      dashboard: 'Dashboard',
      register: 'Asset Register',
      database: 'Asset Database',
      qr: 'QR Scanner & Tags',
      locations: 'Asset Location',
      pic: 'PIC Management',
      movements: 'Asset Movement',
      maintenance: 'Maintenance',
      opname: 'Stock Opname',
      replacement: 'Replacement Plan',
      reports: 'Reports Center',
      governance: 'Governance & Smart AI',
      operations: 'Health, DR & Quality Gate',
      users: 'User Management',
      settings: 'System Settings',
      account: 'Account Settings',
    },
    topbar: {
      searchPlaceholder: 'Search asset code, name, serial, PIC...',
      notifications: 'System Alerts',
      noNotifications: 'All inventory alerts are resolved.',
      logout: 'Logout',
      role: 'Role',
      accountSettings: 'Account Settings',
      themeLight: 'Light Mode',
      themeDark: 'Dark Mode',
      toggleTheme: 'Toggle Light / Dark theme',
    },
    common: {
      save: 'Save',
      cancel: 'Cancel',
      confirm: 'Confirm',
      delete: 'Delete',
      edit: 'Edit',
      view: 'View Details',
      add: 'Add New',
      search: 'Search',
      filter: 'Filter',
      reset: 'Reset',
      exportExcel: 'Export Excel',
      exportPdf: 'Print / PDF',
      importData: 'Import CSV / Excel',
      print: 'Print',
      loading: 'Loading inventory data...',
      noData: 'No matching records found.',
      actions: 'Actions',
      status: 'Status',
      condition: 'Condition',
      all: 'All',
    },
    conditions: {
      Good: 'Good',
      'Minor Damage': 'Minor Damage',
      'Major Damage': 'Major Damage',
      Unserviceable: 'Unserviceable',
    },
    dashboard: {
      title: 'Executive Inventory Overview',
      subtitle: 'Real-time centralized asset monitoring across KIDECO facilities',
      totalAssets: 'Total Registered Assets',
      totalValue: 'Total Acquisition Value',
      goodCondition: 'Good Condition',
      minorDamage: 'Minor Damage',
      majorDamage: 'Major Damage',
      unserviceable: 'Unserviceable',
      inMaintenance: 'In Maintenance',
      missingPic: 'Assets Without PIC',
      missingQr: 'Missing QR Code',
      recentMovements: 'Recent Asset Movements',
      alertsTitle: 'Maintenance & Replacement Notifications',
      chartCategory: 'Assets by Category',
      chartLocation: 'Assets by Location',
      chartCondition: 'Asset Condition Breakdown',
      chartAcquisition: 'Asset Acquisition per Year',
      chartMaintenance: 'Maintenance Status',
      chartMovement: 'Asset Movement History',
      chartLifecycle: '12-Month Asset Acquisition & Retirement Trends',
      chartLifecycleDesc: 'Rolling 12-month comparison of newly acquired assets vs. retired, disposed, or unserviceable assets for long-term replacement planning',
      quickActionsTitle: 'Quick Actions',
      quickActions: {
        scanQr: 'Scan QR',
        scanQrDesc: 'Verify tag, status & field capture',
        newRegistration: 'New Registration',
        newRegistrationDesc: 'Onboard asset with auto QR tag',
        generateReport: 'Generate Report',
        generateReportDesc: 'Export registers to Excel or PDF',
        stockOpname: 'Stock Opname',
        stockOpnameDesc: 'Run physical audit & reconciliation',
      },
    },
    auth: {
      loginTitle: 'Sign in to KIDECO OIMS',
      setupTitle: 'Initial Super Administrator Setup',
      setupDesc: 'Claim the first Super Administrator account to unlock your KIDECO OIMS workspace.',
      usernameOrEmail: 'Username or Corporate Email',
      password: 'Password',
      signIn: 'Sign In',
      createAdminBtn: 'Initialize OIMS & Create Admin',
      seedRolesOption: 'Also initialize sample role accounts (Inventory Admin, PIC, Supervisor, Auditor) with this password',
      fullName: 'Full Name',
      username: 'Username',
      email: 'Corporate Email',
      forgotPassword: 'Forgot Password?',
      forgotPasswordTitle: 'Reset Password via Email',
      forgotPasswordDesc: 'Enter your registered corporate email to receive a 6-digit confirmation code and reset link.',
      sendResetCodeBtn: 'Send Confirmation Code',
      verifyCodeBtn: 'Verify Email Code',
      resetPasswordBtn: 'Save New Password',
      verificationCode: '6-Digit Email Verification Code',
      newPassword: 'New Password (min. 8 characters)',
      confirmNewPassword: 'Confirm New Password',
      backToLogin: 'Back to Sign In',
      resendCode: 'Resend Code',
    },
  },
  id: {
    brandSubtitle: 'Member of Indika Energy Group',
    roadmapTag: 'Digitalisasi 2027–2031',
    vision: 'Satu Aset · Satu Identitas · Satu Database',
    nav: {
      dashboard: 'Dashboard',
      register: 'Registrasi Aset',
      database: 'Database Aset',
      qr: 'QR Scanner & Label',
      locations: 'Lokasi Aset',
      pic: 'Manajemen PIC',
      movements: 'Perpindahan Aset',
      maintenance: 'Pemeliharaan',
      opname: 'Stock Opname',
      replacement: 'Rencana Penggantian',
      reports: 'Pusat Laporan',
      governance: 'Tata Kelola & Smart AI',
      operations: 'Kesehatan, DR & Rilis',
      users: 'Manajemen Pengguna',
      settings: 'Pengaturan Sistem',
      account: 'Pengaturan Akun',
    },
    topbar: {
      searchPlaceholder: 'Cari kode aset, nama barang, serial, PIC...',
      notifications: 'Notifikasi Sistem',
      noNotifications: 'Tidak ada peringatan inventaris aktif.',
      logout: 'Keluar',
      role: 'Peran',
      accountSettings: 'Pengaturan Akun',
      themeLight: 'Mode Terang',
      themeDark: 'Mode Gelap',
      toggleTheme: 'Ubah Mode Terang / Gelap',
    },
    common: {
      save: 'Simpan',
      cancel: 'Batal',
      confirm: 'Konfirmasi',
      delete: 'Hapus',
      edit: 'Ubah',
      view: 'Lihat Detail',
      add: 'Tambah Baru',
      search: 'Cari',
      filter: 'Filter',
      reset: 'Atur Ulang',
      exportExcel: 'Ekspor Excel',
      exportPdf: 'Cetak / PDF',
      importData: 'Impor CSV / Excel',
      print: 'Cetak',
      loading: 'Memuat data inventaris...',
      noData: 'Tidak ada data yang sesuai.',
      actions: 'Aksi',
      status: 'Status',
      condition: 'Kondisi',
      all: 'Semua',
    },
    conditions: {
      Good: 'Baik',
      'Minor Damage': 'Rusak Ringan',
      'Major Damage': 'Rusak Berat',
      Unserviceable: 'Tidak Layak',
    },
    dashboard: {
      title: 'Ringkasan Eksekutif Inventaris',
      subtitle: 'Pemantauan aset terpusat secara real-time di seluruh fasilitas KIDECO',
      totalAssets: 'Total Seluruh Aset',
      totalValue: 'Total Nilai Perolehan',
      goodCondition: 'Kondisi Baik',
      minorDamage: 'Rusak Ringan',
      majorDamage: 'Rusak Berat',
      unserviceable: 'Tidak Layak Pakai',
      inMaintenance: 'Dalam Pemeliharaan',
      missingPic: 'Aset Tanpa PIC',
      missingQr: 'Belum Ada QR Code',
      recentMovements: 'Riwayat Perpindahan Terbaru',
      alertsTitle: 'Notifikasi Pemeliharaan & Penggantian',
      chartCategory: 'Aset per Kategori',
      chartLocation: 'Aset per Lokasi',
      chartCondition: 'Distribusi Kondisi Aset',
      chartAcquisition: 'Perolehan Aset per Tahun',
      chartMaintenance: 'Status Pemeliharaan Aset',
      chartMovement: 'Tren Perpindahan Aset',
      chartLifecycle: 'Tren Perolehan & Penghentian Aset (12 Bulan Terakhir)',
      chartLifecycleDesc: 'Perbandingan 12 bulan terakhir antara aset baru yang diperoleh dan aset yang dihentikan, dihapusbukukan, atau tidak layak pakai untuk perencanaan jangka panjang',
      quickActionsTitle: 'Aksi Cepat',
      quickActions: {
        scanQr: 'Pindai QR',
        scanQrDesc: 'Cek label, status & verifikasi lapangan',
        newRegistration: 'Registrasi Baru',
        newRegistrationDesc: 'Daftarkan aset & buat QR otomatis',
        generateReport: 'Buat Laporan',
        generateReportDesc: 'Ekspor register ke Excel atau PDF',
        stockOpname: 'Stock Opname',
        stockOpnameDesc: 'Audit fisik & rekonsiliasi aset',
      },
    },
    auth: {
      loginTitle: 'Masuk ke KIDECO OIMS',
      setupTitle: 'Pengaturan Awal Super Administrator',
      setupDesc: 'Tetapkan akun Super Administrator pertama untuk mengaktifkan sistem KIDECO OIMS.',
      usernameOrEmail: 'Username atau Email Perusahaan',
      password: 'Kata Sandi',
      signIn: 'Masuk',
      createAdminBtn: 'Inisialisasi OIMS & Buat Admin',
      seedRolesOption: 'Sekaligus aktifkan akun peran contoh (Inventory Admin, PIC, Supervisor, Auditor) dengan kata sandi ini',
      fullName: 'Nama Lengkap',
      username: 'Username',
      email: 'Email Perusahaan',
      forgotPassword: 'Lupa Password?',
      forgotPasswordTitle: 'Reset Password via Konfirmasi Email',
      forgotPasswordDesc: 'Masukkan email perusahaan yang terdaftar untuk menerima kode konfirmasi 6 digit dan tautan reset password.',
      sendResetCodeBtn: 'Kirim Kode Konfirmasi',
      verifyCodeBtn: 'Verifikasi Kode Email',
      resetPasswordBtn: 'Simpan Password Baru',
      verificationCode: 'Kode Verifikasi Email (6 Digit)',
      newPassword: 'Password Baru (min. 8 karakter)',
      confirmNewPassword: 'Konfirmasi Password Baru',
      backToLogin: 'Kembali ke Halaman Masuk',
      resendCode: 'Kirim Ulang Kode',
    },
  },
};
