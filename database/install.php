<?php
/**
 * KIDECO OIMS (Office Inventory Management System)
 * Database & Super Administrator Installer (PHP 8.2+ / MySQL 8 / PDO)
 *
 * Checks for existing database tables in MySQL; if none exist, initializes schema
 * from oims.sql and prompts the user for their desired Super Administrator email
 * and password to populate the initial `users` row with `super_admin` privileges.
 */

declare(strict_types=1);

session_start();

if (empty($_SESSION['oims_install_csrf'])) {
    $_SESSION['oims_install_csrf'] = bin2hex(random_bytes(32));
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Splits a .sql dump file into executable statements while respecting quoted strings and comments.
 *
 * @return string[]
 */
function splitSqlStatements(string $sql): array
{
    $statements = [];
    $buffer = '';
    $length = strlen($sql);
    $inSingle = false;
    $inDouble = false;
    $inLineComment = false;
    $inBlockComment = false;

    for ($i = 0; $i < $length; $i++) {
        $char = $sql[$i];
        $next = ($i + 1 < $length) ? $sql[$i + 1] : '';

        if ($inLineComment) {
            if ($char === "\n") {
                $inLineComment = false;
            }
            continue;
        }

        if ($inBlockComment) {
            if ($char === '*' && $next === '/') {
                $inBlockComment = false;
                $i++;
            }
            continue;
        }

        if (!$inSingle && !$inDouble) {
            if (($char === '-' && $next === '-') || $char === '#') {
                $inLineComment = true;
                continue;
            }
            if ($char === '/' && $next === '*') {
                $inBlockComment = true;
                $i++;
                continue;
            }
        }

        if ($char === "'" && !$inDouble) {
            $escaped = ($i > 0 && $sql[$i - 1] === '\\');
            if (!$escaped) {
                $inSingle = !$inSingle;
            }
        } elseif ($char === '"' && !$inSingle) {
            $escaped = ($i > 0 && $sql[$i - 1] === '\\');
            if (!$escaped) {
                $inDouble = !$inDouble;
            }
        }

        if ($char === ';' && !$inSingle && !$inDouble) {
            $trimmed = trim($buffer);
            if ($trimmed !== '') {
                $statements[] = $trimmed;
            }
            $buffer = '';
            continue;
        }

        $buffer .= $char;
    }

    $tail = trim($buffer);
    if ($tail !== '') {
        $statements[] = $tail;
    }

    return $statements;
}

function isValidDbIdentifier(string $name): bool
{
    return (bool) preg_match('/^[a-zA-Z0-9_]{1,64}$/', $name);
}

/**
 * Connects to MySQL server & database and checks existing tables via information_schema and SHOW TABLES.
 */
function inspectDatabaseState(string $host, string $port, string $dbName, string $dbUser, string $dbPass): array
{
    if (!isValidDbIdentifier($dbName)) {
        throw new InvalidArgumentException('Database name may only contain letters, numbers, and underscores.');
    }

    $dsnServer = sprintf('mysql:host=%s;port=%s;charset=utf8mb4', $host, $port);
    $pdo = new PDO($dsnServer, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    // Check if target database schema exists
    $dbStmt = $pdo->prepare('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
    $dbStmt->execute([$dbName]);
    $dbExists = (bool) $dbStmt->fetchColumn();

    if (!$dbExists) {
        return [
            'pdo' => $pdo,
            'dbExists' => false,
            'tables' => [],
            'isEmpty' => true,
            'hasTables' => false,
            'hasAdmin' => false,
            'error' => null,
        ];
    }

    // Query information_schema.TABLES for existing MySQL tables in the target schema
    $tblStmt = $pdo->prepare(
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME'
    );
    $tblStmt->execute([$dbName]);
    $tables = $tblStmt->fetchAll(PDO::FETCH_COLUMN) ?: [];

    $pdo->exec('USE `' . $dbName . '`');
    $isEmpty = count($tables) === 0;
    $hasTables = !$isEmpty
        && in_array('users', $tables, true)
        && in_array('roles', $tables, true)
        && in_array('permissions', $tables, true)
        && in_array('role_permissions', $tables, true)
        && in_array('user_roles', $tables, true);

    $hasAdmin = false;
    if ($hasTables) {
        $adminCount = (int) $pdo->query(
            "SELECT COUNT(*)
             FROM users u
             INNER JOIN user_roles ur ON ur.user_id = u.id
             INNER JOIN roles r ON r.id = ur.role_id
             WHERE r.code = 'super_admin'
               AND u.password_hash IS NOT NULL
               AND u.password_hash <> ''"
        )->fetchColumn();
        $hasAdmin = $adminCount > 0;
    }

    return [
        'pdo' => $pdo,
        'dbExists' => true,
        'tables' => $tables,
        'isEmpty' => $isEmpty,
        'hasTables' => $hasTables,
        'hasAdmin' => $hasAdmin,
        'error' => null,
    ];
}

/**
 * Ensures full RBAC role & permission baseline exists for `super_admin` inside an active PDO transaction.
 */
function ensureSuperAdminRbac(PDO $pdo): int
{
    $roleCheck = $pdo->prepare("SELECT id FROM roles WHERE code = 'super_admin' LIMIT 1");
    $roleCheck->execute();
    $superRoleId = $roleCheck->fetchColumn();

    if (!$superRoleId) {
        $insertRole = $pdo->prepare(
            "INSERT INTO roles (code, name, description)
             VALUES ('super_admin', 'Super Administrator', 'Full access to all modules, users, security settings, and database backup/restore.')"
        );
        $insertRole->execute();
        $superRoleId = (int) $pdo->lastInsertId();
    }

    $corePermissions = [
        ['dashboard.view', 'dashboard', 'view'],
        ['assets.view', 'assets', 'view'],
        ['assets.create', 'assets', 'create'],
        ['assets.edit', 'assets', 'edit'],
        ['assets.delete', 'assets', 'delete'],
        ['assets.import', 'assets', 'import'],
        ['assets.export', 'assets', 'export'],
        ['qr.view', 'qr', 'view'],
        ['qr.generate', 'qr', 'generate'],
        ['qr.scan', 'qr', 'scan'],
        ['qr.print', 'qr', 'print'],
        ['locations.view', 'locations', 'view'],
        ['locations.create', 'locations', 'create'],
        ['locations.edit', 'locations', 'edit'],
        ['locations.delete', 'locations', 'delete'],
        ['pic.view', 'pic', 'view'],
        ['pic.create', 'pic', 'create'],
        ['pic.edit', 'pic', 'edit'],
        ['pic.assign', 'pic', 'assign'],
        ['movements.view', 'movements', 'view'],
        ['movements.request', 'movements', 'request'],
        ['movements.approve', 'movements', 'approve'],
        ['maintenance.view', 'maintenance', 'view'],
        ['maintenance.report', 'maintenance', 'report'],
        ['maintenance.update', 'maintenance', 'update'],
        ['maintenance.approve', 'maintenance', 'approve'],
        ['opname.view', 'opname', 'view'],
        ['opname.schedule', 'opname', 'schedule'],
        ['opname.verify', 'opname', 'verify'],
        ['replacement.view', 'replacement', 'view'],
        ['replacement.configure', 'replacement', 'configure'],
        ['replacement.plan', 'replacement', 'plan'],
        ['reports.view', 'reports', 'view'],
        ['reports.export', 'reports', 'export'],
        ['users.view', 'users', 'view'],
        ['users.manage', 'users', 'manage'],
        ['settings.view', 'settings', 'view'],
        ['settings.manage', 'settings', 'manage'],
        ['settings.backup', 'settings', 'backup'],
        ['governance.view', 'governance', 'view'],
        ['governance.manage', 'governance', 'manage'],
        ['ai.identify', 'ai', 'identify'],
        ['ai.verify', 'ai', 'verify'],
        ['ops.health.view', 'operations', 'view'],
        ['ops.dr.manage', 'operations', 'manage'],
    ];

    $insertPerm = $pdo->prepare(
        'INSERT IGNORE INTO permissions (code, module, action, description) VALUES (?, ?, ?, ?)'
    );
    foreach ($corePermissions as [$code, $mod, $act]) {
        $insertPerm->execute([$code, $mod, $act, "{$act} access on {$mod}"]);
    }

    $grantAll = $pdo->prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT :role_id, id FROM permissions'
    );
    $grantAll->execute([':role_id' => (int) $superRoleId]);

    return (int) $superRoleId;
}

// Default DB parameters (overrideable via environment variables or the installer form)
$dbHost = trim((string) ($_POST['db_host'] ?? getenv('OIMS_DB_HOST') ?: '127.0.0.1'));
$dbPort = trim((string) ($_POST['db_port'] ?? getenv('OIMS_DB_PORT') ?: '3306'));
$dbName = trim((string) ($_POST['db_name'] ?? getenv('OIMS_DB_NAME') ?: 'oims'));
$dbUser = trim((string) ($_POST['db_user'] ?? getenv('OIMS_DB_USER') ?: 'root'));
$dbPass = (string) ($_POST['db_pass'] ?? getenv('OIMS_DB_PASS') ?: '');

$emailInput = trim((string) ($_POST['admin_email'] ?? ''));
$usernameInput = trim((string) ($_POST['admin_username'] ?? 'admin'));
$fullNameInput = trim((string) ($_POST['admin_full_name'] ?? 'Super Administrator'));

$errorMsg = '';
$successMsg = '';
$state = [
    'dbExists' => false,
    'tables' => [],
    'isEmpty' => true,
    'hasTables' => false,
    'hasAdmin' => false,
    'error' => null,
];

try {
    $state = inspectDatabaseState($dbHost, $dbPort, $dbName, $dbUser, $dbPass);
} catch (Throwable $e) {
    $state['error'] = 'Database connection check failed: ' . $e->getMessage();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $errorMsg === '') {
    $csrf = (string) ($_POST['csrf_token'] ?? '');
    if (!hash_equals($_SESSION['oims_install_csrf'], $csrf)) {
        $errorMsg = 'Invalid security token. Please reload the page and try again.';
    } else {
        $passwordInput = (string) ($_POST['admin_password'] ?? '');
        $confirmInput = (string) ($_POST['admin_password_confirm'] ?? '');

        if (!isValidDbIdentifier($dbName)) {
            $errorMsg = 'Database name may only contain letters, numbers, and underscores.';
        } elseif (!filter_var($emailInput, FILTER_VALIDATE_EMAIL)) {
            $errorMsg = 'Please enter a valid Super Administrator email address.';
        } elseif ($usernameInput === '' || !preg_match('/^[a-zA-Z0-9._-]{3,50}$/', $usernameInput)) {
            $errorMsg = 'Username must be 3–50 characters (letters, numbers, dot, underscore, or hyphen).';
        } elseif (strlen($passwordInput) < 8) {
            $errorMsg = 'Super Administrator password must be at least 8 characters long.';
        } elseif ($passwordInput !== $confirmInput) {
            $errorMsg = 'Password confirmation does not match.';
        } else {
            try {
                $state = inspectDatabaseState($dbHost, $dbPort, $dbName, $dbUser, $dbPass);
                /** @var PDO $pdo */
                $pdo = $state['pdo'];

                if ($state['hasTables'] && $state['hasAdmin']) {
                    $errorMsg = 'Installation is already complete. A Super Administrator already exists in the users table.';
                } else {
                    $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$dbName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
                    $pdo->exec("USE `{$dbName}`");

                    // Step 1 (DDL): If MySQL database has no tables yet (or core tables missing), create schema from oims.sql
                    $currentTables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) ?: [];
                    if (count($currentTables) === 0 || !in_array('users', $currentTables, true) || !in_array('roles', $currentTables, true)) {
                        $sqlFile = __DIR__ . '/oims.sql';
                        if (!is_file($sqlFile)) {
                            throw new RuntimeException('Schema file oims.sql not found alongside install.php.');
                        }
                        $sqlContent = file_get_contents($sqlFile);
                        if ($sqlContent === false) {
                            throw new RuntimeException('Unable to read oims.sql schema file.');
                        }
                        $statements = splitSqlStatements($sqlContent);
                        foreach ($statements as $stmtSql) {
                            // Skip CREATE DATABASE / USE inside oims.sql so the selected target DB is respected
                            if (preg_match('/^\s*(CREATE\s+DATABASE|USE)\b/i', $stmtSql)) {
                                continue;
                            }
                            $pdo->exec($stmtSql);
                        }
                    }

                    // Step 2 (Atomic SQL Transaction): Ensure RBAC permissions & insert initial Super Administrator
                    $pdo->beginTransaction();

                    $existingAdmin = (int) $pdo->query(
                        "SELECT COUNT(*)
                         FROM users u
                         INNER JOIN user_roles ur ON ur.user_id = u.id
                         INNER JOIN roles r ON r.id = ur.role_id
                         WHERE r.code = 'super_admin'
                           AND u.password_hash IS NOT NULL
                           AND u.password_hash <> ''"
                    )->fetchColumn();

                    if ($existingAdmin > 0) {
                        $pdo->rollBack();
                        throw new RuntimeException('Super Administrator already exists.');
                    }

                    $superRoleId = ensureSuperAdminRbac($pdo);
                    $passwordHash = password_hash($passwordInput, PASSWORD_DEFAULT);

                    $insertUser = $pdo->prepare(
                        'INSERT INTO users (username, email, full_name, password_hash, is_active, created_at, updated_at)
                         VALUES (:username, :email, :full_name, :password_hash, 1, NOW(), NOW())'
                    );
                    $insertUser->execute([
                        ':username' => strtolower($usernameInput),
                        ':email' => strtolower($emailInput),
                        ':full_name' => $fullNameInput !== '' ? $fullNameInput : 'Super Administrator',
                        ':password_hash' => $passwordHash,
                    ]);
                    $adminUserId = (int) $pdo->lastInsertId();

                    $insertUserRole = $pdo->prepare(
                        'INSERT INTO user_roles (user_id, role_id) VALUES (:user_id, :role_id)'
                    );
                    $insertUserRole->execute([
                        ':user_id' => $adminUserId,
                        ':role_id' => $superRoleId,
                    ]);

                    $holdingId = $pdo->query('SELECT id FROM holding_groups ORDER BY id ASC LIMIT 1')->fetchColumn();
                    if (!$holdingId) {
                        $pdo->exec("INSERT INTO holding_groups (code, name, description) VALUES ('INDIKA-GRP', 'Indika Energy Group', 'Holding Group induk untuk seluruh entitas operasional dan korporat.')");
                        $holdingId = (int) $pdo->lastInsertId();
                    }
                    $insertScope = $pdo->prepare(
                        "INSERT INTO user_org_scopes (user_id, scope_level, holding_id, company_id, division_id, is_default)
                         VALUES (:user_id, 'holding', :holding_id, NULL, NULL, 1)"
                    );
                    $insertScope->execute([
                        ':user_id' => $adminUserId,
                        ':holding_id' => (int) $holdingId,
                    ]);

                    $auditStmt = $pdo->prepare(
                        'INSERT INTO audit_logs (user_id, username, action, module, entity_type, entity_id, details_json, ip_address)
                         VALUES (:user_id, :username, :action, :module, :entity_type, :entity_id, :details_json, :ip_address)'
                    );
                    $auditStmt->execute([
                        ':user_id' => $adminUserId,
                        ':username' => strtolower($usernameInput),
                        ':action' => 'INSTALLER_ADMIN_CREATED',
                        ':module' => 'installer',
                        ':entity_type' => 'user',
                        ':entity_id' => (string) $adminUserId,
                        ':details_json' => json_encode([
                            'email' => strtolower($emailInput),
                            'role' => 'super_admin',
                            'rbac_verified' => true,
                        ]),
                        ':ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
                    ]);

                    $pdo->commit();
                    $_SESSION['oims_install_csrf'] = bin2hex(random_bytes(32));

                    $state = inspectDatabaseState($dbHost, $dbPort, $dbName, $dbUser, $dbPass);
                    $successMsg = sprintf(
                        'Database initialized (%d tables) and Super Administrator "%s" created with full RBAC permissions.',
                        count($state['tables']),
                        strtolower($emailInput)
                    );
                }
            } catch (Throwable $e) {
                if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                $errorMsg = 'Installation failed: ' . $e->getMessage();
            }
        }
    }
}

$tableCount = count($state['tables']);
$isLocked = $state['hasTables'] && $state['hasAdmin'];
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KIDECO OIMS · Database Installer (install.php)</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-[#141619] text-neutral-900 flex items-center justify-center p-6">
  <div class="max-w-3xl w-full bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-xl">
    <div class="bg-[#1C1F24] text-white px-6 py-5 border-b border-neutral-800 flex items-center justify-between">
      <div>
        <div class="text-[11px] font-mono uppercase tracking-wider text-[#C8102E]">KIDECO · Digitalization 2027–2031</div>
        <h1 class="text-xl font-bold tracking-tight mt-0.5">OIMS Database &amp; Super Administrator Installer</h1>
      </div>
      <span class="text-xs font-mono px-2.5 py-1 rounded bg-neutral-800 text-neutral-300">install.php</span>
    </div>

    <div class="p-6 space-y-5">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 rounded border border-neutral-200 bg-neutral-50">
          <div class="text-neutral-500">Database Schema</div>
          <div class="font-mono font-semibold mt-0.5"><?= h($dbName) ?></div>
        </div>
        <div class="p-3 rounded border border-neutral-200 bg-neutral-50">
          <div class="text-neutral-500">Existing MySQL Tables</div>
          <div class="font-mono font-semibold mt-0.5">
            <?= (int) $tableCount ?> / 46
            <?= $state['isEmpty'] ? '(Empty)' : '' ?>
          </div>
        </div>
        <div class="p-3 rounded border border-neutral-200 bg-neutral-50">
          <div class="text-neutral-500">Super Administrator</div>
          <div class="font-semibold mt-0.5 <?= $state['hasAdmin'] ? 'text-emerald-700' : 'text-[#C8102E]' ?>">
            <?= $state['hasAdmin'] ? 'Configured &amp; Locked' : 'Not Configured' ?>
          </div>
        </div>
      </div>

      <?php if (!empty($state['error'])): ?>
        <div class="p-3.5 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded">
          <?= h((string) $state['error']) ?>
        </div>
      <?php endif; ?>

      <?php if ($errorMsg !== ''): ?>
        <div class="p-3.5 text-xs bg-red-50 border border-red-200 text-[#C8102E] font-medium rounded">
          <?= h($errorMsg) ?>
        </div>
      <?php endif; ?>

      <?php if ($successMsg !== ''): ?>
        <div class="p-4 text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded space-y-2">
          <div class="font-semibold"><?= h($successMsg) ?></div>
          <p>For production security, delete or restrict access to <code class="font-mono">install.php</code> now that installation is complete.</p>
        </div>
      <?php elseif ($isLocked): ?>
        <div class="p-4 text-xs bg-neutral-100 border border-neutral-200 text-neutral-700 rounded space-y-1.5">
          <div class="font-semibold text-[#141619]">KIDECO OIMS is already installed.</div>
          <p>All <?= (int) $tableCount ?> tables and an active Super Administrator account exist in the <code class="font-mono">users</code> table. Re-running this installer is disabled.</p>
        </div>
      <?php else: ?>
        <form method="post" class="space-y-4">
          <input type="hidden" name="csrf_token" value="<?= h($_SESSION['oims_install_csrf']) ?>" />

          <div class="border border-neutral-200 rounded p-4 space-y-3 bg-neutral-50/70">
            <div class="text-xs font-semibold text-[#141619]">1. MySQL / MariaDB Connection</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label class="block text-neutral-600 mb-1">Host</label>
                <input type="text" name="db_host" value="<?= h($dbHost) ?>" required class="w-full px-3 py-2 border border-neutral-300 rounded bg-white font-mono" />
              </div>
              <div>
                <label class="block text-neutral-600 mb-1">Port</label>
                <input type="text" name="db_port" value="<?= h($dbPort) ?>" required class="w-full px-3 py-2 border border-neutral-300 rounded bg-white font-mono" />
              </div>
              <div>
                <label class="block text-neutral-600 mb-1">Database Name</label>
                <input type="text" name="db_name" value="<?= h($dbName) ?>" required class="w-full px-3 py-2 border border-neutral-300 rounded bg-white font-mono" />
              </div>
              <div>
                <label class="block text-neutral-600 mb-1">MySQL User</label>
                <input type="text" name="db_user" value="<?= h($dbUser) ?>" required class="w-full px-3 py-2 border border-neutral-300 rounded bg-white font-mono" />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-neutral-600 mb-1">MySQL Password (optional for local XAMPP)</label>
                <input type="password" name="db_pass" value="" class="w-full px-3 py-2 border border-neutral-300 rounded bg-white font-mono" />
              </div>
            </div>
          </div>

          <div class="border border-neutral-200 rounded p-4 space-y-3">
            <div class="text-xs font-semibold text-[#141619]">2. Create Initial Super Administrator Account</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label class="block text-neutral-600 mb-1">Super Admin Email *</label>
                <input type="email" name="admin_email" value="<?= h($emailInput) ?>" required placeholder="admin@kideco.co.id" class="w-full px-3 py-2 border border-neutral-300 rounded" />
              </div>
              <div>
                <label class="block text-neutral-600 mb-1">Username *</label>
                <input type="text" name="admin_username" value="<?= h($usernameInput) ?>" required class="w-full px-3 py-2 border border-neutral-300 rounded font-mono" />
              </div>
              <div class="sm:col-span-2">
                <label class="block text-neutral-600 mb-1">Full Name *</label>
                <input type="text" name="admin_full_name" value="<?= h($fullNameInput) ?>" required class="w-full px-3 py-2 border border-neutral-300 rounded" />
              </div>
              <div>
                <label class="block text-neutral-600 mb-1">Password (min. 8 characters) *</label>
                <input type="password" name="admin_password" required minlength="8" class="w-full px-3 py-2 border border-neutral-300 rounded" />
              </div>
              <div>
                <label class="block text-neutral-600 mb-1">Confirm Password *</label>
                <input type="password" name="admin_password_confirm" required minlength="8" class="w-full px-3 py-2 border border-neutral-300 rounded" />
              </div>
            </div>
          </div>

          <button type="submit" class="w-full py-2.5 px-4 text-xs font-semibold text-white bg-[#C8102E] hover:bg-[#A10D24] rounded transition-colors">
            Initialize Database Tables &amp; Create Super Administrator
          </button>
        </form>
      <?php endif; ?>
    </div>
  </div>
</body>
</html>
