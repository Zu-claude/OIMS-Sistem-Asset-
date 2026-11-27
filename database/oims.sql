-- ============================================================================
-- KIDECO OIMS (Office Inventory Management System)
-- Digitalization Roadmap 2027-2031 | MySQL 8 / MariaDB Import Script
-- Generated: 2026-11-27 08:25:08
-- Compatible with phpMyAdmin / MySQL 8.0+ / XAMPP
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `oims` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `oims`;

-- 1. users
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(100) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `full_name` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(50) NULL,
  `department` VARCHAR(120) NULL,
  `position_title` VARCHAR(120) NULL,
  `password_hash` VARCHAR(255) NULL,
  `avatar_url` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. roles
CREATE TABLE IF NOT EXISTS `roles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(60) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. permissions
CREATE TABLE IF NOT EXISTS `permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(100) NOT NULL,
  `module` VARCHAR(60) NOT NULL,
  `action` VARCHAR(60) NOT NULL,
  `description` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permissions_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. role_permissions
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` BIGINT UNSIGNED NOT NULL,
  `permission_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `permission_id`),
  CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rp_perm` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. user_roles
CREATE TABLE IF NOT EXISTS `user_roles` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`user_id`, `role_id`),
  CONSTRAINT `fk_ur_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ur_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. holding_groups
CREATE TABLE IF NOT EXISTS `holding_groups` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_holding_groups_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. companies
CREATE TABLE IF NOT EXISTS `companies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `holding_id` BIGINT UNSIGNED NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `address` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_companies_code` (`code`),
  CONSTRAINT `fk_comp_holding` FOREIGN KEY (`holding_id`) REFERENCES `holding_groups`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. divisions
CREATE TABLE IF NOT EXISTS `divisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `department` VARCHAR(150) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_divisions_code` (`code`),
  CONSTRAINT `fk_div_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. user_org_scopes
CREATE TABLE IF NOT EXISTS `user_org_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `scope_level` ENUM('holding','company','division') NOT NULL,
  `holding_id` BIGINT UNSIGNED NULL,
  `company_id` BIGINT UNSIGNED NULL,
  `division_id` BIGINT UNSIGNED NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_uos_user` (`user_id`),
  KEY `idx_uos_company` (`company_id`),
  CONSTRAINT `fk_uos_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uos_holding` FOREIGN KEY (`holding_id`) REFERENCES `holding_groups`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uos_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uos_division` FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. categories
CREATE TABLE IF NOT EXISTS `categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `default_useful_life_years` INT NOT NULL DEFAULT 5,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. subcategories
CREATE TABLE IF NOT EXISTS `subcategories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subcategories_code` (`code`),
  CONSTRAINT `fk_sub_cat` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. buildings
CREATE TABLE IF NOT EXISTS `buildings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(190) NOT NULL,
  `address` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_buildings_code` (`code`),
  CONSTRAINT `fk_bld_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. floors
CREATE TABLE IF NOT EXISTS `floors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `building_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `level_number` INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_floor_bld` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. rooms
CREATE TABLE IF NOT EXISTS `rooms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `floor_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `room_code` VARCHAR(50) NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_room_floor` FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. locations
CREATE TABLE IF NOT EXISTS `locations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `building_id` BIGINT UNSIGNED NOT NULL,
  `floor_id` BIGINT UNSIGNED NOT NULL,
  `room_id` BIGINT UNSIGNED NOT NULL,
  `specific_location` VARCHAR(190) NOT NULL,
  `location_code` VARCHAR(80) NOT NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_locations_code` (`location_code`),
  CONSTRAINT `fk_loc_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_loc_building` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_loc_floor` FOREIGN KEY (`floor_id`) REFERENCES `floors`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_loc_room` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. persons (PIC)
CREATE TABLE IF NOT EXISTS `persons` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nik_nip` VARCHAR(60) NOT NULL,
  `full_name` VARCHAR(190) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `division_id` BIGINT UNSIGNED NOT NULL,
  `department` VARCHAR(150) NULL,
  `position_title` VARCHAR(150) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(50) NULL,
  `status` ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_persons_nik` (`nik_nip`),
  CONSTRAINT `fk_pic_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pic_division` FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. assets
CREATE TABLE IF NOT EXISTS `assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_code` VARCHAR(50) NOT NULL,
  `asset_name` VARCHAR(220) NOT NULL,
  `category_id` BIGINT UNSIGNED NOT NULL,
  `subcategory_id` BIGINT UNSIGNED NULL,
  `brand` VARCHAR(120) NULL,
  `model` VARCHAR(120) NULL,
  `serial_number` VARCHAR(120) NULL,
  `description` TEXT NULL,
  `specification` TEXT NULL,
  `acquisition_date` DATE NOT NULL,
  `acquisition_value` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `supplier` VARCHAR(190) NULL,
  `purchase_reference` VARCHAR(120) NULL,
  `warranty_period_months` INT NULL DEFAULT 12,
  `acquisition_source` VARCHAR(100) NULL DEFAULT 'CAPEX Purchase',
  `company_id` BIGINT UNSIGNED NOT NULL,
  `division_id` BIGINT UNSIGNED NOT NULL,
  `department` VARCHAR(150) NULL,
  `location_id` BIGINT UNSIGNED NOT NULL,
  `pic_id` BIGINT UNSIGNED NULL,
  `condition_status` ENUM('Good','Minor Damage','Major Damage','Unserviceable') NOT NULL DEFAULT 'Good',
  `asset_status` ENUM('Active','In Maintenance','Pending Transfer','Missing','Disposed') NOT NULL DEFAULT 'Active',
  `primary_photo_url` VARCHAR(500) NULL,
  `data_owner_user_id` BIGINT UNSIGNED NULL,
  `custodian_person_id` BIGINT UNSIGNED NULL,
  `responsible_division_id` BIGINT UNSIGNED NULL,
  `verification_officer_user_id` BIGINT UNSIGNED NULL,
  `approver_user_id` BIGINT UNSIGNED NULL,
  `legal_hold` TINYINT(1) NOT NULL DEFAULT 0,
  `archived_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assets_code` (`asset_code`),
  KEY `idx_assets_serial` (`serial_number`),
  KEY `idx_assets_location` (`location_id`),
  KEY `idx_assets_pic` (`pic_id`),
  KEY `idx_assets_condition` (`condition_status`),
  CONSTRAINT `fk_asset_cat` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_asset_subcat` FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_asset_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_asset_div` FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_asset_loc` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_asset_pic` FOREIGN KEY (`pic_id`) REFERENCES `persons`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. asset_photos
CREATE TABLE IF NOT EXISTS `asset_photos` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_url` VARCHAR(500) NOT NULL,
  `drive_file_id` VARCHAR(200) NULL,
  `drive_web_view_link` VARCHAR(500) NULL,
  `mime_type` VARCHAR(120) NULL,
  `file_size_bytes` BIGINT UNSIGNED NULL,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `uploaded_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_photo_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 19. asset_documents
CREATE TABLE IF NOT EXISTS `asset_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `doc_type` VARCHAR(80) NOT NULL DEFAULT 'Supporting Document',
  `file_name` VARCHAR(255) NOT NULL,
  `file_url` VARCHAR(500) NOT NULL,
  `drive_file_id` VARCHAR(200) NULL,
  `drive_web_view_link` VARCHAR(500) NULL,
  `mime_type` VARCHAR(120) NULL,
  `file_size_bytes` BIGINT UNSIGNED NULL,
  `uploaded_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_doc_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 20. asset_qr_codes
CREATE TABLE IF NOT EXISTS `asset_qr_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `qr_token` VARCHAR(120) NOT NULL,
  `public_slug` VARCHAR(64) NULL,
  `status` ENUM('Active','Revoked') NOT NULL DEFAULT 'Active',
  `public_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `public_show_photo` TINYINT(1) NOT NULL DEFAULT 1,
  `public_show_location` TINYINT(1) NOT NULL DEFAULT 1,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `revoked_by` BIGINT UNSIGNED NULL,
  `revoked_reason` TEXT NULL,
  `generated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `generated_by` BIGINT UNSIGNED NULL,
  `last_scanned_at` DATETIME NULL,
  `scan_count` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_qr_asset` (`asset_id`),
  UNIQUE KEY `uq_qr_token` (`qr_token`),
  UNIQUE KEY `uq_qr_public_slug` (`public_slug`),
  CONSTRAINT `fk_qr_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 21. asset_movements
CREATE TABLE IF NOT EXISTS `asset_movements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `movement_code` VARCHAR(60) NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `from_location_id` BIGINT UNSIGNED NOT NULL,
  `to_location_id` BIGINT UNSIGNED NOT NULL,
  `from_pic_id` BIGINT UNSIGNED NULL,
  `to_pic_id` BIGINT UNSIGNED NULL,
  `from_company_id` BIGINT UNSIGNED NULL,
  `to_company_id` BIGINT UNSIGNED NULL,
  `from_division_id` BIGINT UNSIGNED NULL,
  `to_division_id` BIGINT UNSIGNED NULL,
  `is_cross_company` TINYINT(1) NOT NULL DEFAULT 0,
  `movement_date` DATETIME NOT NULL,
  `reason` TEXT NOT NULL,
  `officer_user_id` BIGINT UNSIGNED NOT NULL,
  `proof_doc_url` VARCHAR(500) NULL,
  `status` ENUM('Pending Approval','Approved','Completed','Rejected','Cancelled') NOT NULL DEFAULT 'Pending Approval',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_movements_code` (`movement_code`),
  CONSTRAINT `fk_mov_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_mov_from_loc` FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_mov_to_loc` FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 22. movement_approvals
CREATE TABLE IF NOT EXISTS `movement_approvals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `movement_id` BIGINT UNSIGNED NOT NULL,
  `approver_user_id` BIGINT UNSIGNED NOT NULL,
  `decision` ENUM('Approved','Rejected') NOT NULL,
  `notes` TEXT NULL,
  `decided_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_movapp_mov` FOREIGN KEY (`movement_id`) REFERENCES `asset_movements`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 23. asset_ownership_history
CREATE TABLE IF NOT EXISTS `asset_ownership_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `from_company_id` BIGINT UNSIGNED NULL,
  `to_company_id` BIGINT UNSIGNED NOT NULL,
  `from_division_id` BIGINT UNSIGNED NULL,
  `to_division_id` BIGINT UNSIGNED NOT NULL,
  `from_custodian_person_id` BIGINT UNSIGNED NULL,
  `to_custodian_person_id` BIGINT UNSIGNED NULL,
  `movement_id` BIGINT UNSIGNED NULL,
  `changed_by_user_id` BIGINT UNSIGNED NULL,
  `reason` TEXT NULL,
  `changed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_aoh_asset` (`asset_id`),
  CONSTRAINT `fk_aoh_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aoh_from_comp` FOREIGN KEY (`from_company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_aoh_to_comp` FOREIGN KEY (`to_company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 24. asset_events (Append-Only Hash-Chained Ledger)
CREATE TABLE IF NOT EXISTS `asset_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_uuid` VARCHAR(80) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `qr_id` BIGINT UNSIGNED NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `actor_user_id` BIGINT UNSIGNED NULL,
  `actor_username` VARCHAR(100) NULL,
  `reference_type` VARCHAR(80) NULL,
  `reference_id` VARCHAR(100) NULL,
  `reason` TEXT NULL,
  `previous_state_json` LONGTEXT NULL,
  `new_state_json` LONGTEXT NULL,
  `prev_hash` VARCHAR(64) NOT NULL,
  `event_hash` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asset_events_uuid` (`event_uuid`),
  KEY `idx_ae_company` (`company_id`),
  KEY `idx_ae_asset` (`asset_id`),
  KEY `idx_ae_type` (`event_type`),
  KEY `idx_ae_created` (`created_at`),
  CONSTRAINT `fk_ae_company` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ae_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 25. maintenance_records
CREATE TABLE IF NOT EXISTS `maintenance_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ticket_code` VARCHAR(60) NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `damage_date` DATE NOT NULL,
  `damage_type` VARCHAR(150) NOT NULL,
  `issue_description` TEXT NOT NULL,
  `repair_action` TEXT NULL,
  `vendor_technician` VARCHAR(190) NULL,
  `cost` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `completion_date` DATE NULL,
  `status` ENUM('Reported','Waiting Approval','In Progress','Completed','Cancelled') NOT NULL DEFAULT 'Reported',
  `before_photo_url` VARCHAR(500) NULL,
  `after_photo_url` VARCHAR(500) NULL,
  `reported_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_maint_ticket` (`ticket_code`),
  CONSTRAINT `fk_maint_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 26. maintenance_approvals
CREATE TABLE IF NOT EXISTS `maintenance_approvals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `maintenance_id` BIGINT UNSIGNED NOT NULL,
  `approver_user_id` BIGINT UNSIGNED NOT NULL,
  `decision` ENUM('Approved','Rejected') NOT NULL,
  `notes` TEXT NULL,
  `decided_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_maintapp_maint` FOREIGN KEY (`maintenance_id`) REFERENCES `maintenance_records`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 27. stock_opname
CREATE TABLE IF NOT EXISTS `stock_opname` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `opname_code` VARCHAR(60) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `scheduled_date` DATE NOT NULL,
  `company_id` BIGINT UNSIGNED NULL,
  `location_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('Scheduled','In Progress','Completed') NOT NULL DEFAULT 'Scheduled',
  `conducted_by` BIGINT UNSIGNED NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_opname_code` (`opname_code`),
  CONSTRAINT `fk_opname_comp` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_opname_loc` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 28. stock_opname_details
CREATE TABLE IF NOT EXISTS `stock_opname_details` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `opname_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `scanned_code` VARCHAR(100) NOT NULL,
  `expected_location_id` BIGINT UNSIGNED NULL,
  `actual_location_id` BIGINT UNSIGNED NULL,
  `expected_condition` VARCHAR(60) NULL,
  `actual_condition` VARCHAR(60) NULL,
  `expected_pic_id` BIGINT UNSIGNED NULL,
  `actual_pic_id` BIGINT UNSIGNED NULL,
  `verification_result` ENUM('Verified','Not Found','Location Mismatch','Condition Mismatch','Unregistered Asset','QR Code Missing') NOT NULL,
  `notes` TEXT NULL,
  `gps_latitude` DECIMAL(10,7) NULL,
  `gps_longitude` DECIMAL(10,7) NULL,
  `gps_accuracy_m` DOUBLE NULL,
  `field_photo_url` VARCHAR(500) NULL,
  `verified_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `verified_by` BIGINT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_opdet_op` FOREIGN KEY (`opname_id`) REFERENCES `stock_opname`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 29. replacement_plans
CREATE TABLE IF NOT EXISTS `replacement_plans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `assessment_year` INT NOT NULL,
  `asset_age_years` DECIMAL(6,2) NOT NULL,
  `maintenance_count` INT NOT NULL DEFAULT 0,
  `total_maintenance_cost` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `priority_level` ENUM('Normal','Monitor','Repair Required','Replacement Recommended','Urgent Replacement') NOT NULL,
  `estimated_replacement_cost` DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  `planned_quarter` VARCHAR(10) NULL DEFAULT 'Q1',
  `notes` TEXT NULL,
  `status` ENUM('Planned','Approved','Procured','Deferred') NOT NULL DEFAULT 'Planned',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_repl_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 30. notifications
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(60) NOT NULL,
  `priority` ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  `title` VARCHAR(220) NOT NULL,
  `message` TEXT NOT NULL,
  `entity_type` VARCHAR(60) NULL,
  `entity_id` BIGINT UNSIGNED NULL,
  `dedupe_key` VARCHAR(120) NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notif_dedupe` (`dedupe_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 31. audit_logs
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `username` VARCHAR(100) NULL,
  `action` VARCHAR(120) NOT NULL,
  `module` VARCHAR(80) NOT NULL,
  `entity_type` VARCHAR(80) NULL,
  `entity_id` VARCHAR(100) NULL,
  `details_json` LONGTEXT NULL,
  `ip_address` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 32. system_settings
CREATE TABLE IF NOT EXISTS `system_settings` (
  `setting_key` VARCHAR(120) NOT NULL,
  `setting_value` TEXT NOT NULL,
  `category` VARCHAR(60) NOT NULL DEFAULT 'general',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` BIGINT UNSIGNED NULL,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 33. password_reset_tokens
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `code_hash` VARCHAR(128) NOT NULL,
  `token_hash` VARCHAR(128) NOT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `max_attempts` INT NOT NULL DEFAULT 5,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `request_ip` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prt_token_hash` (`token_hash`),
  KEY `idx_prt_user` (`user_id`),
  CONSTRAINT `fk_prt_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 34. qr_access_logs
CREATE TABLE IF NOT EXISTS `qr_access_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `qr_id` BIGINT UNSIGNED NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `token_attempted` VARCHAR(160) NOT NULL,
  `access_tier` ENUM('public','authenticated','administrative','denied') NOT NULL,
  `outcome` ENUM('granted','revoked','expired','not_found','rate_limited','forbidden','public_disabled') NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(300) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_qral_qr` (`qr_id`),
  KEY `idx_qral_created` (`created_at`),
  CONSTRAINT `fk_qral_qr` FOREIGN KEY (`qr_id`) REFERENCES `asset_qr_codes`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_qral_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 35. asset_field_captures
CREATE TABLE IF NOT EXISTS `asset_field_captures` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `qr_id` BIGINT UNSIGNED NULL,
  `opname_id` BIGINT UNSIGNED NULL,
  `captured_by_user_id` BIGINT UNSIGNED NULL,
  `capture_context` VARCHAR(50) NOT NULL DEFAULT 'field_scan',
  `latitude` DECIMAL(10,7) NULL,
  `longitude` DECIMAL(10,7) NULL,
  `accuracy_meters` DOUBLE NULL,
  `photo_url` VARCHAR(500) NULL,
  `condition_observed` VARCHAR(60) NULL,
  `notes` TEXT NULL,
  `captured_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_afc_asset` (`asset_id`),
  KEY `idx_afc_company` (`company_id`),
  CONSTRAINT `fk_afc_comp` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_afc_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 36. asset_reconciliation_findings
CREATE TABLE IF NOT EXISTS `asset_reconciliation_findings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `finding_code` VARCHAR(60) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `opname_id` BIGINT UNSIGNED NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `scanned_code` VARCHAR(120) NULL,
  `reconciliation_status` ENUM('MATCHED','LOCATION_MISMATCH','CONDITION_MISMATCH','UNIDENTIFIED_ASSET','MISSING_ASSET','DUPLICATE_SUSPECTED','INCOMPLETE_DATA','QR_MISMATCH','PENDING_REVIEW') NOT NULL,
  `priority` ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  `title` VARCHAR(220) NOT NULL,
  `discrepancy_summary` TEXT NOT NULL,
  `expected_snapshot_json` LONGTEXT NULL,
  `observed_snapshot_json` LONGTEXT NULL,
  `evidence_photo_url` VARCHAR(500) NULL,
  `gps_latitude` DECIMAL(10,7) NULL,
  `gps_longitude` DECIMAL(10,7) NULL,
  `assigned_to_user_id` BIGINT UNSIGNED NULL,
  `resolution_status` ENUM('Open','In Review','Resolved','Dismissed') NOT NULL DEFAULT 'Open',
  `resolution_notes` TEXT NULL,
  `master_updated` TINYINT(1) NOT NULL DEFAULT 0,
  `resolved_by_user_id` BIGINT UNSIGNED NULL,
  `resolved_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_arf_code` (`finding_code`),
  KEY `idx_arf_company` (`company_id`),
  KEY `idx_arf_status` (`reconciliation_status`),
  CONSTRAINT `fk_arf_comp` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_arf_opname` FOREIGN KEY (`opname_id`) REFERENCES `stock_opname`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_arf_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 37. retention_policies
CREATE TABLE IF NOT EXISTS `retention_policies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `policy_code` VARCHAR(60) NOT NULL,
  `record_class` VARCHAR(80) NOT NULL,
  `title` VARCHAR(190) NOT NULL,
  `description` TEXT NULL,
  `retention_days` INT NOT NULL DEFAULT 1825,
  `action_mode` ENUM('immutable_retain','archive_record','purge_non_ledger') NOT NULL,
  `is_immutable_ledger` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_evaluated_at` DATETIME NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rp_code` (`policy_code`),
  UNIQUE KEY `uq_rp_class` (`record_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 38. record_retention_holds
CREATE TABLE IF NOT EXISTS `record_retention_holds` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hold_code` VARCHAR(60) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `hold_reason` TEXT NOT NULL,
  `status` ENUM('Active','Released') NOT NULL DEFAULT 'Active',
  `placed_by_user_id` BIGINT UNSIGNED NULL,
  `placed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `released_by_user_id` BIGINT UNSIGNED NULL,
  `released_at` DATETIME NULL,
  `release_notes` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rrh_code` (`hold_code`),
  KEY `idx_rrh_asset` (`asset_id`),
  KEY `idx_rrh_company` (`company_id`),
  CONSTRAINT `fk_rrh_comp` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_rrh_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 39. enterprise_sops
CREATE TABLE IF NOT EXISTS `enterprise_sops` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sop_code` VARCHAR(60) NOT NULL,
  `company_id` BIGINT UNSIGNED NULL,
  `title` VARCHAR(220) NOT NULL,
  `category` VARCHAR(100) NOT NULL,
  `version` VARCHAR(30) NOT NULL DEFAULT '1.0',
  `mandatory_module` VARCHAR(60) NOT NULL,
  `checklist_json` LONGTEXT NOT NULL,
  `is_mandatory` TINYINT(1) NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sop_code` (`sop_code`),
  CONSTRAINT `fk_sop_comp` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 40. sop_executions
CREATE TABLE IF NOT EXISTS `sop_executions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `execution_code` VARCHAR(60) NOT NULL,
  `sop_id` BIGINT UNSIGNED NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `module_context` VARCHAR(60) NOT NULL,
  `executed_by_user_id` BIGINT UNSIGNED NOT NULL,
  `checklist_results_json` LONGTEXT NOT NULL,
  `compliance_status` ENUM('Compliant','Deviation') NOT NULL,
  `deviation_notes` TEXT NULL,
  `signed_off_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sopex_code` (`execution_code`),
  KEY `idx_sopex_company` (`company_id`),
  KEY `idx_sopex_sop` (`sop_id`),
  CONSTRAINT `fk_sopex_sop` FOREIGN KEY (`sop_id`) REFERENCES `enterprise_sops`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_sopex_comp` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_sopex_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 41. integration_connectors
CREATE TABLE IF NOT EXISTS `integration_connectors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `connector_code` VARCHAR(60) NOT NULL,
  `company_id` BIGINT UNSIGNED NULL,
  `name` VARCHAR(190) NOT NULL,
  `connector_type` ENUM('erp_sync','hris_sync','procurement_sync','webhook') NOT NULL,
  `endpoint_url` VARCHAR(500) NOT NULL,
  `auth_scheme` ENUM('None','Bearer Env','HMAC Header') NOT NULL DEFAULT 'Bearer Env',
  `env_secret_ref` VARCHAR(120) NULL,
  `data_classification` ENUM('Public','Internal','Confidential') NOT NULL DEFAULT 'Internal',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `last_test_status` VARCHAR(60) NULL,
  `last_tested_at` DATETIME NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ic_code` (`connector_code`),
  CONSTRAINT `fk_ic_comp` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 42. integration_logs
CREATE TABLE IF NOT EXISTS `integration_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `connector_id` BIGINT UNSIGNED NOT NULL,
  `company_id` BIGINT UNSIGNED NULL,
  `direction` ENUM('outbound','dry_run') NOT NULL DEFAULT 'outbound',
  `status` ENUM('Success','DryRun','Blocked','Failed') NOT NULL,
  `http_status` INT NULL,
  `request_summary` TEXT NULL,
  `response_summary` TEXT NULL,
  `triggered_by_user_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ilog_connector` (`connector_id`),
  CONSTRAINT `fk_ilog_conn` FOREIGN KEY (`connector_id`) REFERENCES `integration_connectors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 43. ai_asset_identifications
CREATE TABLE IF NOT EXISTS `ai_asset_identifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `identification_code` VARCHAR(60) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `source_photo_url` VARCHAR(500) NOT NULL,
  `photo_sha256` VARCHAR(128) NULL,
  `analysis_mode` ENUM('local_dedup_similarity','gemini_vision_ocr') NOT NULL,
  `external_consent_confirmed` TINYINT(1) NOT NULL DEFAULT 0,
  `model_used` VARCHAR(100) NULL,
  `extracted_serial_number` VARCHAR(120) NULL,
  `extracted_label` VARCHAR(220) NULL,
  `extracted_brand` VARCHAR(120) NULL,
  `extracted_model` VARCHAR(120) NULL,
  `extracted_specs` TEXT NULL,
  `recommended_category_id` BIGINT UNSIGNED NULL,
  `duplicate_matches_json` LONGTEXT NULL,
  `similarity_matches_json` LONGTEXT NULL,
  `raw_ai_json` LONGTEXT NULL,
  `verification_status` ENUM('Pending Review','Accepted','Rejected','Applied') NOT NULL DEFAULT 'Pending Review',
  `applied_fields_json` TEXT NULL,
  `requested_by_user_id` BIGINT UNSIGNED NULL,
  `verified_by_user_id` BIGINT UNSIGNED NULL,
  `verified_at` DATETIME NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_aiid_code` (`identification_code`),
  KEY `idx_aiid_company` (`company_id`),
  KEY `idx_aiid_sha256` (`photo_sha256`),
  KEY `idx_aiid_status` (`verification_status`),
  CONSTRAINT `fk_aiid_comp` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_aiid_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_aiid_cat` FOREIGN KEY (`recommended_category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 44. dr_backup_verifications
CREATE TABLE IF NOT EXISTS `dr_backup_verifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `verification_code` VARCHAR(60) NOT NULL,
  `verification_type` ENUM('sqlite_integrity_check','snapshot_dry_run','backup_export_check','restore_drill_sandbox','manual_bcp_drill') NOT NULL,
  `backup_version` VARCHAR(60) NULL,
  `snapshot_sha256` VARCHAR(128) NULL,
  `table_count` INT NOT NULL DEFAULT 0,
  `record_count` INT NOT NULL DEFAULT 0,
  `rpo_minutes` INT NULL,
  `rto_minutes` INT NULL,
  `status` ENUM('Passed','Warning','Failed') NOT NULL,
  `summary` TEXT NOT NULL,
  `details_json` LONGTEXT NULL,
  `verified_by_user_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_drver_code` (`verification_code`),
  KEY `idx_drver_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 45. bcp_runbooks
CREATE TABLE IF NOT EXISTS `bcp_runbooks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `runbook_code` VARCHAR(60) NOT NULL,
  `title` VARCHAR(220) NOT NULL,
  `scenario` VARCHAR(80) NOT NULL,
  `rto_target_minutes` INT NOT NULL DEFAULT 60,
  `rpo_target_minutes` INT NOT NULL DEFAULT 15,
  `owner_role` VARCHAR(120) NOT NULL,
  `steps_json` LONGTEXT NOT NULL,
  `last_tested_at` DATETIME NULL,
  `last_test_status` ENUM('Not Tested','Passed','Action Required') NOT NULL DEFAULT 'Not Tested',
  `updated_by` BIGINT UNSIGNED NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bcp_code` (`runbook_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 46. enterprise_acceptance_signoffs
CREATE TABLE IF NOT EXISTS `enterprise_acceptance_signoffs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `release_tag` VARCHAR(80) NOT NULL,
  `gate_scope` VARCHAR(80) NOT NULL,
  `gate_status` ENUM('Passed','Conditional','Failed') NOT NULL,
  `checks_passed` INT NOT NULL DEFAULT 0,
  `checks_total` INT NOT NULL DEFAULT 0,
  `checks_json` LONGTEXT NOT NULL,
  `notes` TEXT NULL,
  `signed_off_by_user_id` BIGINT UNSIGNED NULL,
  `signed_off_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- SEED / SNAPSHOT DATA EXPORTED FROM LIVE OIMS
-- ============================================================================
-- Data for `roles`
INSERT INTO `roles` (`id`, `code`, `name`, `description`, `created_at`) VALUES (1, 'super_admin', 'Super Administrator', 'Full access to all modules, users, security settings, and database backup/restore.', '2026-11-26 12:34:25');
INSERT INTO `roles` (`id`, `code`, `name`, `description`, `created_at`) VALUES (2, 'inventory_admin', 'Inventory Administrator', 'Manages asset registration, QR tagging, locations, PICs, stock opname, and reports.', '2026-11-26 12:34:25');
INSERT INTO `roles` (`id`, `code`, `name`, `description`, `created_at`) VALUES (3, 'pic_custodian', 'PIC / Asset Custodian', 'Views assigned assets, reports damage, and submits transfer requests.', '2026-11-26 12:34:25');
INSERT INTO `roles` (`id`, `code`, `name`, `description`, `created_at`) VALUES (4, 'approver', 'Approver / Supervisor', 'Approves asset movements, maintenance requests, and reviews condition/replacement reports.', '2026-11-26 12:34:25');
INSERT INTO `roles` (`id`, `code`, `name`, `description`, `created_at`) VALUES (5, 'auditor', 'Viewer / Auditor', 'Read-only access to dashboard, asset inventory, audit logs, and reports.', '2026-11-26 12:34:25');

-- Data for `permissions`
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (1, 'dashboard.view', 'dashboard', 'view', 'view access on dashboard');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (2, 'assets.view', 'assets', 'view', 'view access on assets');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (3, 'assets.create', 'assets', 'create', 'create access on assets');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (4, 'assets.edit', 'assets', 'edit', 'edit access on assets');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (5, 'assets.delete', 'assets', 'delete', 'delete access on assets');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (6, 'assets.import', 'assets', 'import', 'import access on assets');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (7, 'assets.export', 'assets', 'export', 'export access on assets');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (8, 'qr.view', 'qr', 'view', 'view access on qr');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (9, 'qr.generate', 'qr', 'generate', 'generate access on qr');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (10, 'qr.scan', 'qr', 'scan', 'scan access on qr');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (11, 'qr.print', 'qr', 'print', 'print access on qr');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (12, 'locations.view', 'locations', 'view', 'view access on locations');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (13, 'locations.create', 'locations', 'create', 'create access on locations');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (14, 'locations.edit', 'locations', 'edit', 'edit access on locations');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (15, 'locations.delete', 'locations', 'delete', 'delete access on locations');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (16, 'pic.view', 'pic', 'view', 'view access on pic');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (17, 'pic.create', 'pic', 'create', 'create access on pic');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (18, 'pic.edit', 'pic', 'edit', 'edit access on pic');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (19, 'pic.assign', 'pic', 'assign', 'assign access on pic');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (20, 'movements.view', 'movements', 'view', 'view access on movements');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (21, 'movements.request', 'movements', 'request', 'request access on movements');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (22, 'movements.approve', 'movements', 'approve', 'approve access on movements');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (23, 'maintenance.view', 'maintenance', 'view', 'view access on maintenance');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (24, 'maintenance.report', 'maintenance', 'report', 'report access on maintenance');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (25, 'maintenance.update', 'maintenance', 'update', 'update access on maintenance');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (26, 'maintenance.approve', 'maintenance', 'approve', 'approve access on maintenance');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (27, 'opname.view', 'opname', 'view', 'view access on opname');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (28, 'opname.schedule', 'opname', 'schedule', 'schedule access on opname');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (29, 'opname.verify', 'opname', 'verify', 'verify access on opname');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (30, 'replacement.view', 'replacement', 'view', 'view access on replacement');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (31, 'replacement.configure', 'replacement', 'configure', 'configure access on replacement');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (32, 'replacement.plan', 'replacement', 'plan', 'plan access on replacement');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (33, 'reports.view', 'reports', 'view', 'view access on reports');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (34, 'reports.export', 'reports', 'export', 'export access on reports');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (35, 'users.view', 'users', 'view', 'view access on users');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (36, 'users.manage', 'users', 'manage', 'manage access on users');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (37, 'settings.view', 'settings', 'view', 'view access on settings');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (38, 'settings.manage', 'settings', 'manage', 'manage access on settings');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (39, 'settings.backup', 'settings', 'backup', 'backup access on settings');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (40, 'governance.view', 'governance', 'view', 'View retention policies, SOP controls, integration registry, and Smart AI recommendations');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (41, 'governance.manage', 'governance', 'manage', 'Manage retention policies, legal holds, enterprise SOPs, and integration connectors');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (42, 'ai.identify', 'ai', 'identify', 'Run Smart Asset Identification (local deduplication or consented Gemini OCR)');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (43, 'ai.verify', 'ai', 'verify', 'Review, accept, reject, or confirm-apply Smart AI asset recommendations');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (64, 'ops.health.view', 'operations', 'view', 'View system health monitoring, DR verification logs, BCP runbooks, and Quality Gate status');
INSERT INTO `permissions` (`id`, `code`, `module`, `action`, `description`) VALUES (65, 'ops.dr.manage', 'operations', 'manage', 'Execute DR integrity checks, dry-run backup verification, BCP drills, and Quality Gate sign-offs');

-- Data for `role_permissions`
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 7);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 2);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 1);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 12);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 26);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 23);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 22);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 20);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 27);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 16);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 8);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 30);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 34);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 33);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 7);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 2);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 1);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 12);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 23);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 20);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 27);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 16);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 8);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 30);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 34);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 33);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 37);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 35);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 3);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 5);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 4);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 7);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 6);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 2);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 1);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 13);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 15);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 14);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 12);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 26);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 24);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 25);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 23);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 22);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 21);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 20);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 28);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 29);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 27);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 19);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 17);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 18);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 16);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 9);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 11);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 10);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 8);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 31);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 32);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 30);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 34);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 33);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 37);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 2);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 1);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 12);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 24);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 23);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 21);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 20);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 27);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 16);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 10);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (3, 8);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 3);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 5);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 4);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 7);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 6);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 2);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 1);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 13);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 15);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 14);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 12);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 26);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 24);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 25);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 23);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 22);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 21);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 20);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 28);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 29);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 27);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 19);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 17);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 18);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 16);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 9);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 11);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 10);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 8);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 31);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 32);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 30);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 34);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 33);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 39);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 38);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 37);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 36);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 35);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 40);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 41);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 42);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 43);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 40);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 42);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (2, 43);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 40);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (4, 43);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 40);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 64);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (1, 65);
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES (5, 64);

-- Data for `holding_groups`
INSERT INTO `holding_groups` (`id`, `code`, `name`, `description`, `created_at`) VALUES (1, 'INDIKA-GRP', 'Indika Energy Group', 'Holding Group induk untuk seluruh entitas operasional dan korporat.', '2026-11-26 13:17:05');

-- Data for `companies`
INSERT INTO `companies` (`id`, `code`, `name`, `address`, `created_at`, `holding_id`) VALUES (1, 'KIDECO', 'PT Kideco Jaya Agung (KIDECO)', 'Graha Mitra, Jl. Jend. Gatot Subroto Kav. 21, Jakarta / Batu Kajang Site, East Kalimantan', '2026-11-26 12:34:25', 1);
INSERT INTO `companies` (`id`, `code`, `name`, `address`, `created_at`, `holding_id`) VALUES (2, 'INDIKA', 'PT Indika Energy Tbk', 'Graha Mitra, Jl. Jend. Gatot Subroto Kav. 21, Jakarta Selatan', '2026-11-26 12:34:25', 1);

-- Data for `divisions`
INSERT INTO `divisions` (`id`, `company_id`, `code`, `name`, `department`, `created_at`) VALUES (1, 1, 'GA', 'General Affairs', 'Facility & Asset Control', '2026-11-26 12:34:25');
INSERT INTO `divisions` (`id`, `company_id`, `code`, `name`, `department`, `created_at`) VALUES (2, 1, 'IT', 'Information Technology', 'Enterprise Infrastructure', '2026-11-26 12:34:25');
INSERT INTO `divisions` (`id`, `company_id`, `code`, `name`, `department`, `created_at`) VALUES (3, 1, 'OPS', 'Mining Operations Support', 'Site Administration', '2026-11-26 12:34:25');
INSERT INTO `divisions` (`id`, `company_id`, `code`, `name`, `department`, `created_at`) VALUES (4, 1, 'FIN', 'Finance & Accounting', 'Corporate Treasury', '2026-11-26 12:34:25');
INSERT INTO `divisions` (`id`, `company_id`, `code`, `name`, `department`, `created_at`) VALUES (5, 1, 'HSE', 'Health, Safety & Environment', 'Compliance & Risk', '2026-11-26 12:34:25');
INSERT INTO `divisions` (`id`, `company_id`, `code`, `name`, `department`, `created_at`) VALUES (6, 2, 'IND-CORP', 'Corporate Holding & Shared Services', 'Group Office', '2026-11-26 13:17:05');

-- Data for `categories`
INSERT INTO `categories` (`id`, `code`, `name`, `default_useful_life_years`, `created_at`) VALUES (1, 'IT', 'IT & Computing Equipment', 4, '2026-11-26 12:34:25');
INSERT INTO `categories` (`id`, `code`, `name`, `default_useful_life_years`, `created_at`) VALUES (2, 'FUR', 'Office Furniture', 7, '2026-11-26 12:34:25');
INSERT INTO `categories` (`id`, `code`, `name`, `default_useful_life_years`, `created_at`) VALUES (3, 'AV', 'Audio Visual & Conference', 5, '2026-11-26 12:34:25');
INSERT INTO `categories` (`id`, `code`, `name`, `default_useful_life_years`, `created_at`) VALUES (4, 'FAC', 'Facility & Electrical', 6, '2026-11-26 12:34:25');

-- Data for `subcategories`
INSERT INTO `subcategories` (`id`, `category_id`, `code`, `name`, `created_at`) VALUES (1, 1, 'IT-LPT', 'Laptop & Workstation', '2026-11-26 12:34:25');
INSERT INTO `subcategories` (`id`, `category_id`, `code`, `name`, `created_at`) VALUES (2, 1, 'IT-PRT', 'Multifunction Printer & Scanner', '2026-11-26 12:34:25');
INSERT INTO `subcategories` (`id`, `category_id`, `code`, `name`, `created_at`) VALUES (3, 1, 'IT-NET', 'Network & Server Hardware', '2026-11-26 12:34:25');
INSERT INTO `subcategories` (`id`, `category_id`, `code`, `name`, `created_at`) VALUES (4, 2, 'FUR-CHR', 'Ergonomic Chair', '2026-11-26 12:34:25');
INSERT INTO `subcategories` (`id`, `category_id`, `code`, `name`, `created_at`) VALUES (5, 2, 'FUR-DSK', 'Workstation Desk & Table', '2026-11-26 12:34:25');
INSERT INTO `subcategories` (`id`, `category_id`, `code`, `name`, `created_at`) VALUES (6, 2, 'FUR-CAB', 'Storage & Filing Cabinet', '2026-11-26 12:34:25');
INSERT INTO `subcategories` (`id`, `category_id`, `code`, `name`, `created_at`) VALUES (7, 3, 'AV-DSP', 'Smart Conference Display', '2026-11-26 12:34:25');
INSERT INTO `subcategories` (`id`, `category_id`, `code`, `name`, `created_at`) VALUES (8, 4, 'FAC-UPS', 'Power Backup & UPS', '2026-11-26 12:34:25');

-- Data for `buildings`
INSERT INTO `buildings` (`id`, `company_id`, `code`, `name`, `address`, `created_at`) VALUES (1, 1, 'BLD-HO', 'KIDECO Office Building (Graha Mitra)', 'Jl. Jend. Gatot Subroto Kav. 21', '2026-11-26 12:34:25');
INSERT INTO `buildings` (`id`, `company_id`, `code`, `name`, `address`, `created_at`) VALUES (2, 1, 'BLD-SITE', 'Batu Kajang Site Administration Wing', 'Paser, Kalimantan Timur', '2026-11-26 12:34:25');
INSERT INTO `buildings` (`id`, `company_id`, `code`, `name`, `address`, `created_at`) VALUES (3, 2, 'BLD-IND-HO', 'Indika Energy Tower (Graha Mitra)', 'Jl. Jend. Gatot Subroto Kav. 21, Jakarta', '2026-11-26 13:17:05');

-- Data for `floors`
INSERT INTO `floors` (`id`, `building_id`, `name`, `level_number`) VALUES (1, 1, 'Floor 1', 1);
INSERT INTO `floors` (`id`, `building_id`, `name`, `level_number`) VALUES (2, 1, 'Floor 2', 2);
INSERT INTO `floors` (`id`, `building_id`, `name`, `level_number`) VALUES (3, 2, 'Ground Floor', 1);
INSERT INTO `floors` (`id`, `building_id`, `name`, `level_number`) VALUES (4, 3, 'Floor 12', 12);

-- Data for `rooms`
INSERT INTO `rooms` (`id`, `floor_id`, `name`, `room_code`) VALUES (1, 1, 'General Affairs', 'RM-GA-01');
INSERT INTO `rooms` (`id`, `floor_id`, `name`, `room_code`) VALUES (2, 1, 'IT Operations Center', 'RM-IT-01');
INSERT INTO `rooms` (`id`, `floor_id`, `name`, `room_code`) VALUES (3, 2, 'Executive Boardroom', 'RM-EX-02');
INSERT INTO `rooms` (`id`, `floor_id`, `name`, `room_code`) VALUES (4, 2, 'Finance Workspace', 'RM-FN-02');
INSERT INTO `rooms` (`id`, `floor_id`, `name`, `room_code`) VALUES (5, 3, 'Site Control Office', 'RM-SC-01');
INSERT INTO `rooms` (`id`, `floor_id`, `name`, `room_code`) VALUES (6, 4, 'Group Asset Office', 'RM-IND-12');

-- Data for `locations`
INSERT INTO `locations` (`id`, `company_id`, `building_id`, `floor_id`, `room_id`, `specific_location`, `location_code`, `notes`, `created_at`, `updated_at`) VALUES (1, 1, 1, 1, 1, 'Storage Room A', 'LOC-KDC-HO-F1-GA-STR', 'Main GA secured storage', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `locations` (`id`, `company_id`, `building_id`, `floor_id`, `room_id`, `specific_location`, `location_code`, `notes`, `created_at`, `updated_at`) VALUES (2, 1, 1, 1, 2, 'Rack & Workstation Bay 2', 'LOC-KDC-HO-F1-IT-BAY2', 'IT provisioning desk', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `locations` (`id`, `company_id`, `building_id`, `floor_id`, `room_id`, `specific_location`, `location_code`, `notes`, `created_at`, `updated_at`) VALUES (3, 1, 1, 2, 3, 'Boardroom Main Table', 'LOC-KDC-HO-F2-EX-BRD', 'Executive conference room', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `locations` (`id`, `company_id`, `building_id`, `floor_id`, `room_id`, `specific_location`, `location_code`, `notes`, `created_at`, `updated_at`) VALUES (4, 1, 1, 2, 4, 'Accounting Pod B', 'LOC-KDC-HO-F2-FN-PODB', 'Finance staff cubicles', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `locations` (`id`, `company_id`, `building_id`, `floor_id`, `room_id`, `specific_location`, `location_code`, `notes`, `created_at`, `updated_at`) VALUES (5, 1, 2, 3, 5, 'Site Dispatch Desk', 'LOC-KDC-BK-GF-SC-DSP', 'Batu Kajang dispatch desk', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `locations` (`id`, `company_id`, `building_id`, `floor_id`, `room_id`, `specific_location`, `location_code`, `notes`, `created_at`, `updated_at`) VALUES (6, 2, 3, 4, 6, 'Corporate Holding Desk', 'LOC-IND-HO-F12-CORP', 'Indika Energy Group corporate office', '2026-11-26 13:17:05', '2026-11-26 13:17:05');

-- Data for `persons`
INSERT INTO `persons` (`id`, `nik_nip`, `full_name`, `company_id`, `division_id`, `department`, `position_title`, `email`, `phone`, `status`, `created_at`, `updated_at`) VALUES (1, 'KDC-10421', 'Budi Santoso', 1, 1, 'Facility & Asset Control', 'General Affairs Supervisor', 'budi.santoso@kideco.co.id', '+62-811-9402-110', 'Active', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `persons` (`id`, `nik_nip`, `full_name`, `company_id`, `division_id`, `department`, `position_title`, `email`, `phone`, `status`, `created_at`, `updated_at`) VALUES (2, 'KDC-10893', 'Siti Rahayu', 1, 2, 'Enterprise Infrastructure', 'IT Systems Lead', 'siti.rahayu@kideco.co.id', '+62-812-8830-421', 'Active', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `persons` (`id`, `nik_nip`, `full_name`, `company_id`, `division_id`, `department`, `position_title`, `email`, `phone`, `status`, `created_at`, `updated_at`) VALUES (3, 'KDC-11204', 'Andi Wijaya', 1, 4, 'Corporate Treasury', 'Senior Financial Analyst', 'andi.wijaya@kideco.co.id', '+62-813-4420-901', 'Active', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `persons` (`id`, `nik_nip`, `full_name`, `company_id`, `division_id`, `department`, `position_title`, `email`, `phone`, `status`, `created_at`, `updated_at`) VALUES (4, 'KDC-11560', 'Dewi Lestari', 1, 3, 'Site Administration', 'Site Operations Coordinator', 'dewi.lestari@kideco.co.id', '+62-811-5521-334', 'Active', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `persons` (`id`, `nik_nip`, `full_name`, `company_id`, `division_id`, `department`, `position_title`, `email`, `phone`, `status`, `created_at`, `updated_at`) VALUES (5, 'KDC-11902', 'Rizal Pratama', 1, 5, 'Compliance & Risk', 'HSE Audit Officer', 'rizal.pratama@kideco.co.id', '+62-812-7740-188', 'Active', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `persons` (`id`, `nik_nip`, `full_name`, `company_id`, `division_id`, `department`, `position_title`, `email`, `phone`, `status`, `created_at`, `updated_at`) VALUES (6, 'IND-20101', 'Hendra Kusuma', 2, 6, 'Group Office', 'Corporate Asset Coordinator', 'hendra.kusuma@indikaenergy.co.id', '+62-811-7700-201', 'Active', '2026-11-26 13:17:05', '2026-11-26 13:17:05');

-- Data for `assets`
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (1, 'OIMS-2027-000001', 'Dell Latitude 7450 Executive Workstation', 1, 1, 'Dell', 'Latitude 7450', 'DL7450-KDC-9921A', 'Corporate engineering & finance laptop', 'Intel Core Ultra 7, 32GB RAM, 1TB NVMe SSD, 14" FHD+', '2025-02-14', 24500000, 'PT Bhinneka Mentari Dimensi', 'PO-KDC-2025-0114', 36, 'CAPEX Purchase', 1, 2, 'Enterprise Infrastructure', 2, 2, 'Good', 'Active', '/src/assets/images/asset_workstation_laptop_1795596197186.jpg', NULL, '2026-11-26 12:34:25', '2026-11-27 08:11:27', NULL, 6, 6, 2, 2, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (2, 'OIMS-2027-000002', 'Herman Miller Aeron Ergonomic Chair', 2, 4, 'Herman Miller', 'Aeron Size B', 'HM-AER-2024-8821', 'Executive mesh ergonomic task chair', 'Graphite Pellicle Mesh, Aluminum Base, Tilt Limiter', '2024-06-10', 19800000, 'PT Graha Interior Nusantara', 'PO-KDC-2024-0482', 60, 'CAPEX Purchase', 1, 1, 'Facility & Asset Control', 3, 1, 'Good', 'Active', '/src/assets/images/asset_ergonomic_chair_1795596197217.jpg', NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25', NULL, NULL, NULL, 1, 1, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (3, 'OIMS-2027-000003', 'Lexmark CX625adhe Multifunction Printer', 1, 2, 'Lexmark', 'CX625adhe', 'LX-CX625-77310', 'High-speed color laser MFP for GA & Finance', '40 ppm Color Laser, Duplex Scan, Gigabit Ethernet', '2023-08-20', 31200000, 'PT Astra Graphia Tbk', 'PO-KDC-2023-0891', 24, 'CAPEX Purchase', 1, 4, 'Corporate Treasury', 4, 3, 'Minor Damage', 'In Maintenance', '/src/assets/images/asset_multifunction_printer_1795596198376.jpg', NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25', NULL, NULL, NULL, 3, 4, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (4, 'OIMS-2027-000004', 'Lenovo ThinkPad T14 Gen 5 Field Unit', 1, 1, 'Lenovo', 'ThinkPad T14 G5', 'LN-T14G5-44102', 'Site operations portable workstation', 'AMD Ryzen 7 PRO, 16GB RAM, 512GB SSD', '2025-01-08', 21400000, 'PT Datascrip Indonesia', 'PO-KDC-2025-0031', 36, 'CAPEX Purchase', 1, 3, 'Site Administration', 5, 4, 'Good', 'Active', '/src/assets/images/asset_workstation_laptop_1795596197186.jpg', NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25', NULL, NULL, NULL, 4, 3, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (5, 'OIMS-2027-000005', 'Samsung 75" Interactive Conference Display', 3, 7, 'Samsung', 'Flip Pro WM75B', 'SM-WM75B-30192', 'Boardroom 4K interactive touch panel', '75-inch 4K UHD, AirPlay/HDMI/USB-C, Mobile Stand', '2024-03-18', 54000000, 'PT Multipolar Technology', 'PO-KDC-2024-0219', 36, 'CAPEX Purchase', 1, 1, 'Facility & Asset Control', 3, 1, 'Good', 'Active', NULL, NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25', NULL, NULL, NULL, 1, 1, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (6, 'OIMS-2027-000006', 'APC Smart-UPS 3000VA Rackmount', 4, 8, 'APC', 'SMT3000RMI2UC', 'APC-3K-192044', 'Server room primary power protection', '3000VA / 2700W, SmartConnect, LCD Status', '2021-05-12', 28900000, 'PT Schneider Electric IT', 'PO-KDC-2021-0311', 24, 'CAPEX Purchase', 1, 2, 'Enterprise Infrastructure', 2, 2, 'Unserviceable', 'In Maintenance', NULL, NULL, '2026-11-26 12:34:25', '2026-11-26 13:40:03', NULL, 1, 1, 2, 2, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (7, 'OIMS-2027-000007', 'Steelcase Gesture Ergonomic Chair', 2, 4, 'Steelcase', 'Gesture 442A', 'SC-GST-2022-6610', 'Task seating for Finance Pod B', '3D LiveBack, Adjustable Arms, Charcoal Fabric', '2022-09-05', 16500000, 'PT Vitra Karya Mandiri', 'PO-KDC-2022-0745', 60, 'CAPEX Purchase', 1, 4, 'Corporate Treasury', 4, 3, 'Good', 'Active', '/src/assets/images/asset_ergonomic_chair_1795596197217.jpg', NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25', NULL, NULL, NULL, 3, 4, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (8, 'OIMS-2027-000008', 'Cisco Catalyst 9200L 48-Port Switch', 1, 3, 'Cisco', 'C9200L-48P-4G', 'CSC-9200-55019', 'Floor 1 PoE+ core distribution switch', '48x PoE+ Ports, 4x 1G SFP Uplinks, Dual PSU', '2020-11-15', 42000000, 'PT Metrodata Electronics', 'PO-KDC-2020-1102', 36, 'CAPEX Purchase', 1, 2, 'Enterprise Infrastructure', 2, 2, 'Good', 'Active', NULL, NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25', NULL, NULL, NULL, 2, 2, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (9, 'OIMS-2027-000009', 'Modera Executive Modular Desk 180cm', 2, 5, 'Modera', 'E-Class 180', 'MOD-180-2023-004', 'Spare executive desk in GA storage', '180x80cm Melamine Walnut/Charcoal Steel Frame', '2023-04-22', 7800000, 'PT Modera Furintraco', 'PO-KDC-2023-0332', 12, 'OPEX Procurement', 1, 1, 'Facility & Asset Control', 1, NULL, 'Good', 'Active', NULL, NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25', NULL, NULL, NULL, NULL, 1, NULL, NULL, 0, NULL);
INSERT INTO `assets` (`id`, `asset_code`, `asset_name`, `category_id`, `subcategory_id`, `brand`, `model`, `serial_number`, `description`, `specification`, `acquisition_date`, `acquisition_value`, `supplier`, `purchase_reference`, `warranty_period_months`, `acquisition_source`, `company_id`, `division_id`, `department`, `location_id`, `pic_id`, `condition_status`, `asset_status`, `primary_photo_url`, `deleted_at`, `created_at`, `updated_at`, `created_by`, `updated_by`, `data_owner_user_id`, `custodian_person_id`, `responsible_division_id`, `verification_officer_user_id`, `approver_user_id`, `legal_hold`, `archived_at`) VALUES (10, 'OIMS-2027-000010', 'HP LaserJet Pro M404dn Legacy Printer', 1, 2, 'HP', 'M404dn', 'HP-M404-19881', 'Legacy monochrome printer slated for retirement', 'Monochrome Laser, 38 ppm, Network Ready', '2019-07-02', 6200000, 'PT Bhinneka Mentari Dimensi', 'PO-KDC-2019-0604', 12, 'OPEX Procurement', 1, 5, 'Compliance & Risk', 1, 5, 'Unserviceable', 'Active', '/src/assets/images/asset_multifunction_printer_1795596198376.jpg', NULL, '2026-11-26 12:34:25', '2026-11-27 08:11:27', NULL, 6, 6, 5, 5, NULL, NULL, 0, NULL);

-- Data for `asset_photos`
INSERT INTO `asset_photos` (`id`, `asset_id`, `file_name`, `file_url`, `drive_file_id`, `drive_web_view_link`, `mime_type`, `file_size_bytes`, `is_primary`, `uploaded_by`, `created_at`) VALUES (1, 1, 'dell_latitude_7450.jpg', '/src/assets/images/asset_workstation_laptop_1795596197186.jpg', NULL, NULL, NULL, NULL, 1, NULL, '2026-11-26 12:34:25');
INSERT INTO `asset_photos` (`id`, `asset_id`, `file_name`, `file_url`, `drive_file_id`, `drive_web_view_link`, `mime_type`, `file_size_bytes`, `is_primary`, `uploaded_by`, `created_at`) VALUES (2, 2, 'herman_miller_aeron.jpg', '/src/assets/images/asset_ergonomic_chair_1795596197217.jpg', NULL, NULL, NULL, NULL, 1, NULL, '2026-11-26 12:34:25');
INSERT INTO `asset_photos` (`id`, `asset_id`, `file_name`, `file_url`, `drive_file_id`, `drive_web_view_link`, `mime_type`, `file_size_bytes`, `is_primary`, `uploaded_by`, `created_at`) VALUES (3, 3, 'lexmark_cx625.jpg', '/src/assets/images/asset_multifunction_printer_1795596198376.jpg', NULL, NULL, NULL, NULL, 1, NULL, '2026-11-26 12:34:25');

-- Data for `asset_qr_codes`
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (1, 1, 'OIMS-QR-70F93BDC28443E74', '2026-11-26 12:34:25', NULL, '2026-11-26 13:40:03', 22, 'od9oI8W_UIKOu67I', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (2, 2, 'OIMS-QR-23E137BEF94957FF', '2026-11-26 13:40:03', 1, '2026-11-26 13:40:03', 2, 'P1xnul5oCg3zN0i4', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (3, 3, 'OIMS-QR-0D6BF85D7A783B64', '2026-11-26 12:34:25', NULL, NULL, 0, 'KtnpfjsV0t9BlOiG', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (4, 4, 'OIMS-QR-DCFC7DEBECF3108F', '2026-11-26 12:34:25', NULL, NULL, 0, 'qAH9QPhDRckOTvt0', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (5, 5, 'OIMS-QR-B108765A595C282B', '2026-11-26 12:34:25', NULL, NULL, 0, 'PaUpLekHl5Hq3UEq', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (6, 6, 'OIMS-QR-C0F655BBB2499E38', '2026-11-26 12:34:25', NULL, NULL, 0, 'BfSqV947QM6rSTFA', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (7, 7, 'OIMS-QR-74C22646EF4E39DF', '2026-11-26 12:34:25', NULL, NULL, 0, '4u6PaSVBbPCNjh1n', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (8, 8, 'OIMS-QR-80B256B1A4CCC5A1', '2026-11-26 12:34:25', NULL, NULL, 0, '5Cd3WAumQ5BNeDdH', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);
INSERT INTO `asset_qr_codes` (`id`, `asset_id`, `qr_token`, `generated_at`, `generated_by`, `last_scanned_at`, `scan_count`, `public_slug`, `status`, `public_enabled`, `public_show_photo`, `public_show_location`, `expires_at`, `revoked_at`, `revoked_by`, `revoked_reason`) VALUES (9, 9, 'OIMS-QR-F80A786898B60BF0', '2026-11-26 12:34:25', NULL, NULL, 0, 'UzWpNEvuKjCjhJC5', 'Active', 1, 1, 1, NULL, NULL, NULL, NULL);

-- Data for `asset_movements`
INSERT INTO `asset_movements` (`id`, `movement_code`, `asset_id`, `from_location_id`, `to_location_id`, `from_pic_id`, `to_pic_id`, `movement_date`, `reason`, `officer_user_id`, `proof_doc_url`, `status`, `created_at`, `updated_at`, `from_company_id`, `to_company_id`, `from_division_id`, `to_division_id`, `is_cross_company`) VALUES (1, 'MOV-2027-0001', 1, 1, 2, 1, 2, '2026-10-14 09:30:00', 'Initial IT provisioning & handover to IT Systems Lead', 1, NULL, 'Completed', '2026-11-26 12:34:25', '2026-11-26 12:34:25', 1, 1, 2, 2, 0);
INSERT INTO `asset_movements` (`id`, `movement_code`, `asset_id`, `from_location_id`, `to_location_id`, `from_pic_id`, `to_pic_id`, `movement_date`, `reason`, `officer_user_id`, `proof_doc_url`, `status`, `created_at`, `updated_at`, `from_company_id`, `to_company_id`, `from_division_id`, `to_division_id`, `is_cross_company`) VALUES (2, 'MOV-2027-0002', 4, 2, 5, 2, 4, '2026-11-02 14:15:00', 'Site deployment for Batu Kajang field operations', 1, NULL, 'Completed', '2026-11-26 12:34:25', '2026-11-26 12:34:25', 1, 1, 3, 3, 0);
INSERT INTO `asset_movements` (`id`, `movement_code`, `asset_id`, `from_location_id`, `to_location_id`, `from_pic_id`, `to_pic_id`, `movement_date`, `reason`, `officer_user_id`, `proof_doc_url`, `status`, `created_at`, `updated_at`, `from_company_id`, `to_company_id`, `from_division_id`, `to_division_id`, `is_cross_company`) VALUES (3, 'MOV-2027-0003', 7, 1, 4, 1, 3, '2026-11-20 10:00:00', 'Reallocation to Finance Pod B expansion', 1, NULL, 'Pending Approval', '2026-11-26 12:34:25', '2026-11-26 12:34:25', 1, 1, 4, 4, 0);

-- Data for `movement_approvals`
INSERT INTO `movement_approvals` (`id`, `movement_id`, `approver_user_id`, `decision`, `notes`, `decided_at`) VALUES (1, 1, 1, 'Approved', 'Verified by General Affairs', '2026-11-26 12:34:25');
INSERT INTO `movement_approvals` (`id`, `movement_id`, `approver_user_id`, `decision`, `notes`, `decided_at`) VALUES (2, 2, 1, 'Approved', 'Site dispatch authorized', '2026-11-26 12:34:25');

-- Data for `maintenance_records`
INSERT INTO `maintenance_records` (`id`, `ticket_code`, `asset_id`, `damage_date`, `damage_type`, `issue_description`, `repair_action`, `vendor_technician`, `cost`, `completion_date`, `status`, `before_photo_url`, `after_photo_url`, `reported_by`, `created_at`, `updated_at`) VALUES (1, 'MNT-2027-0001', 3, '2026-11-10', 'Paper Feed Jam / Roller Wear', 'ADF roller slips during duplex scanning', 'Replace ADF pickup roller assembly', 'Astra Graphia Field Service', 1850000, NULL, 'In Progress', NULL, NULL, NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `maintenance_records` (`id`, `ticket_code`, `asset_id`, `damage_date`, `damage_type`, `issue_description`, `repair_action`, `vendor_technician`, `cost`, `completion_date`, `status`, `before_photo_url`, `after_photo_url`, `reported_by`, `created_at`, `updated_at`) VALUES (2, 'MNT-2027-0002', 6, '2026-11-18', 'Battery Cell Degradation', 'UPS battery warning alarm & runtime < 3 min', 'Full battery cartridge replacement required', 'Schneider Authorized Partner', 6400000, NULL, 'Waiting Approval', NULL, NULL, NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `maintenance_records` (`id`, `ticket_code`, `asset_id`, `damage_date`, `damage_type`, `issue_description`, `repair_action`, `vendor_technician`, `cost`, `completion_date`, `status`, `before_photo_url`, `after_photo_url`, `reported_by`, `created_at`, `updated_at`) VALUES (3, 'MNT-2027-0003', 8, '2026-06-12', 'Fan Module Noise', 'Cooling fan bearing vibration detected', 'Cleaned chassis and replaced fan tray', 'Metrodata Support', 1200000, '2026-06-16', 'Completed', NULL, NULL, NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `maintenance_records` (`id`, `ticket_code`, `asset_id`, `damage_date`, `damage_type`, `issue_description`, `repair_action`, `vendor_technician`, `cost`, `completion_date`, `status`, `before_photo_url`, `after_photo_url`, `reported_by`, `created_at`, `updated_at`) VALUES (4, 'MNT-2027-0004', 10, '2026-09-05', 'Fuser Unit Failure', 'Fuser heating element failed; parts discontinued', 'Recommended for disposal & replacement', 'Internal IT', 0, NULL, 'Reported', NULL, NULL, NULL, '2026-11-26 12:34:25', '2026-11-26 12:34:25');

-- Data for `stock_opname`
INSERT INTO `stock_opname` (`id`, `opname_code`, `title`, `scheduled_date`, `location_id`, `status`, `conducted_by`, `notes`, `created_at`, `completed_at`, `company_id`) VALUES (1, 'OPN-2027-Q4-01', 'Q4 2026 Head Office IT & Finance Physical Audit', '2026-11-28', 2, 'In Progress', NULL, 'Annual physical verification for IT Operations Center', '2026-11-26 12:34:25', NULL, 1);

-- Data for `stock_opname_details`
INSERT INTO `stock_opname_details` (`id`, `opname_id`, `asset_id`, `scanned_code`, `expected_location_id`, `actual_location_id`, `expected_condition`, `actual_condition`, `expected_pic_id`, `actual_pic_id`, `verification_result`, `notes`, `verified_at`, `verified_by`, `gps_latitude`, `gps_longitude`, `gps_accuracy_m`, `field_photo_url`) VALUES (1, 1, 1, 'OIMS-2027-000001', 2, 2, 'Good', 'Good', 2, 2, 'Verified', 'Physical tag & serial confirmed', '2026-11-26 12:34:25', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `stock_opname_details` (`id`, `opname_id`, `asset_id`, `scanned_code`, `expected_location_id`, `actual_location_id`, `expected_condition`, `actual_condition`, `expected_pic_id`, `actual_pic_id`, `verification_result`, `notes`, `verified_at`, `verified_by`, `gps_latitude`, `gps_longitude`, `gps_accuracy_m`, `field_photo_url`) VALUES (2, 1, 6, 'OIMS-2027-000006', 2, 2, 'Good', 'Major Damage', 2, 2, 'Condition Mismatch', 'UPS battery alarm active on rack inspection', '2026-11-26 12:34:25', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `stock_opname_details` (`id`, `opname_id`, `asset_id`, `scanned_code`, `expected_location_id`, `actual_location_id`, `expected_condition`, `actual_condition`, `expected_pic_id`, `actual_pic_id`, `verification_result`, `notes`, `verified_at`, `verified_by`, `gps_latitude`, `gps_longitude`, `gps_accuracy_m`, `field_photo_url`) VALUES (3, 1, 8, 'OIMS-2027-000008', 2, 2, 'Good', 'Good', 2, 2, 'Verified', 'Core switch verified in rack', '2026-11-26 12:34:25', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `stock_opname_details` (`id`, `opname_id`, `asset_id`, `scanned_code`, `expected_location_id`, `actual_location_id`, `expected_condition`, `actual_condition`, `expected_pic_id`, `actual_pic_id`, `verification_result`, `notes`, `verified_at`, `verified_by`, `gps_latitude`, `gps_longitude`, `gps_accuracy_m`, `field_photo_url`) VALUES (4, 1, 6, 'OIMS-2027-000006', 2, 2, 'Major Damage', 'Major Damage', 2, 2, 'Verified', 'Battery fault confirmed in field', '2026-11-26 13:39:39', 1, -1.8691, 115.9685, 10, NULL);
INSERT INTO `stock_opname_details` (`id`, `opname_id`, `asset_id`, `scanned_code`, `expected_location_id`, `actual_location_id`, `expected_condition`, `actual_condition`, `expected_pic_id`, `actual_pic_id`, `verification_result`, `notes`, `verified_at`, `verified_by`, `gps_latitude`, `gps_longitude`, `gps_accuracy_m`, `field_photo_url`) VALUES (5, 1, 6, 'OIMS-2027-000006', 2, 2, 'Major Damage', 'Unserviceable', 2, 2, 'Condition Mismatch', 'UPS unit failure confirmed in field', '2026-11-26 13:40:03', 1, -1.8691, 115.9685, 10, NULL);

-- Data for `replacement_plans`
INSERT INTO `replacement_plans` (`id`, `asset_id`, `assessment_year`, `asset_age_years`, `maintenance_count`, `total_maintenance_cost`, `priority_level`, `estimated_replacement_cost`, `planned_quarter`, `notes`, `status`, `created_at`, `updated_at`) VALUES (1, 10, 2027, 7.4, 2, 1800000, 'Urgent Replacement', 8500000, 'Q1', 'Unserviceable legacy printer past 4-year useful life', 'Approved', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `replacement_plans` (`id`, `asset_id`, `assessment_year`, `asset_age_years`, `maintenance_count`, `total_maintenance_cost`, `priority_level`, `estimated_replacement_cost`, `planned_quarter`, `notes`, `status`, `created_at`, `updated_at`) VALUES (2, 6, 2027, 5.5, 1, 6400000, 'Replacement Recommended', 32000000, 'Q2', 'Major battery/inverter wear nearing 6-year lifecycle', 'Planned', '2026-11-26 12:34:25', '2026-11-26 12:34:25');
INSERT INTO `replacement_plans` (`id`, `asset_id`, `assessment_year`, `asset_age_years`, `maintenance_count`, `total_maintenance_cost`, `priority_level`, `estimated_replacement_cost`, `planned_quarter`, `notes`, `status`, `created_at`, `updated_at`) VALUES (3, 8, 2027, 6, 1, 1200000, 'Monitor', 45000000, 'Q4', 'Operating normally but past 4-year IT lifecycle', 'Planned', '2026-11-26 12:34:25', '2026-11-26 12:34:25');

-- Data for `asset_events`
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (1, '0c06d123-efad-49c9-b0f5-fb7b5fed5e8f', 1, 1, 1, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '1', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000001","asset_name":"Dell Latitude 7450 Executive Workstation","asset_status":"Active","company_id":1,"condition_status":"Good","custodian_person_id":2,"data_owner_user_id":null,"deleted_at":null,"department":"Enterprise Infrastructure","division_id":2,"id":1,"location_id":2,"pic_id":2,"responsible_division_id":2,"verification_officer_user_id":null}', 'GENESIS', '812a5ad11ec4d8000928fdcdf096c14ff27501fd8a264e6ef9d458ffb153dc80', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (2, '0174ced8-d015-4d1f-8c1c-b1ab25c29ad8', 1, 2, 2, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '2', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000002","asset_name":"Herman Miller Aeron Ergonomic Chair","asset_status":"Active","company_id":1,"condition_status":"Good","custodian_person_id":1,"data_owner_user_id":null,"deleted_at":null,"department":"Facility & Asset Control","division_id":1,"id":2,"location_id":3,"pic_id":1,"responsible_division_id":1,"verification_officer_user_id":null}', '812a5ad11ec4d8000928fdcdf096c14ff27501fd8a264e6ef9d458ffb153dc80', '253d1d227e80ba79bc141f5cc0a73e0e9299f6261319b5aeb65246a8c5f03fc1', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (3, '1959e0d8-0945-4fe6-97b4-835089b688aa', 1, 3, 3, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '3', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000003","asset_name":"Lexmark CX625adhe Multifunction Printer","asset_status":"In Maintenance","company_id":1,"condition_status":"Minor Damage","custodian_person_id":3,"data_owner_user_id":null,"deleted_at":null,"department":"Corporate Treasury","division_id":4,"id":3,"location_id":4,"pic_id":3,"responsible_division_id":4,"verification_officer_user_id":null}', '253d1d227e80ba79bc141f5cc0a73e0e9299f6261319b5aeb65246a8c5f03fc1', '1caa7e4db90257f533229e3150000a34b0e5e12feafd7aa93c726df9a7dd76dc', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (4, 'ad68dfcf-188a-4656-9719-c18dee41b107', 1, 4, 4, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '4', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000004","asset_name":"Lenovo ThinkPad T14 Gen 5 Field Unit","asset_status":"Active","company_id":1,"condition_status":"Good","custodian_person_id":4,"data_owner_user_id":null,"deleted_at":null,"department":"Site Administration","division_id":3,"id":4,"location_id":5,"pic_id":4,"responsible_division_id":3,"verification_officer_user_id":null}', '1caa7e4db90257f533229e3150000a34b0e5e12feafd7aa93c726df9a7dd76dc', '4ba2f7e0a411a9803900fd89bd06d44f3a616fc1f682ead9958883245a465c62', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (5, 'af5dcd5e-5e33-4151-aa7a-a9b5b18f52c2', 1, 5, 5, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '5', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000005","asset_name":"Samsung 75\\" Interactive Conference Display","asset_status":"Active","company_id":1,"condition_status":"Good","custodian_person_id":1,"data_owner_user_id":null,"deleted_at":null,"department":"Facility & Asset Control","division_id":1,"id":5,"location_id":3,"pic_id":1,"responsible_division_id":1,"verification_officer_user_id":null}', '4ba2f7e0a411a9803900fd89bd06d44f3a616fc1f682ead9958883245a465c62', '7b38fb40a7c9f1710e8eb3a21a94e372b9f3057ac0482a2391954fd85174a51a', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (6, 'bee47774-0418-4162-9843-f43e780f5f20', 1, 6, 6, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '6', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000006","asset_name":"APC Smart-UPS 3000VA Rackmount","asset_status":"In Maintenance","company_id":1,"condition_status":"Major Damage","custodian_person_id":2,"data_owner_user_id":null,"deleted_at":null,"department":"Enterprise Infrastructure","division_id":2,"id":6,"location_id":2,"pic_id":2,"responsible_division_id":2,"verification_officer_user_id":null}', '7b38fb40a7c9f1710e8eb3a21a94e372b9f3057ac0482a2391954fd85174a51a', '954da6b1cc25d3a5760242eabe426244f5bc85eddeeffeb58f06975fba931559', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (7, '5a8a5995-0c5e-4090-859c-2eb65e1ab6f0', 1, 7, 7, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '7', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000007","asset_name":"Steelcase Gesture Ergonomic Chair","asset_status":"Active","company_id":1,"condition_status":"Good","custodian_person_id":3,"data_owner_user_id":null,"deleted_at":null,"department":"Corporate Treasury","division_id":4,"id":7,"location_id":4,"pic_id":3,"responsible_division_id":4,"verification_officer_user_id":null}', '954da6b1cc25d3a5760242eabe426244f5bc85eddeeffeb58f06975fba931559', 'bab9fd28cbffa482e2a40c9da883931ae3fb428cc095188053d797190ac05b1c', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (8, 'f58ced00-ccbc-472e-a73c-3ea27b06c729', 1, 8, 8, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '8', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000008","asset_name":"Cisco Catalyst 9200L 48-Port Switch","asset_status":"Active","company_id":1,"condition_status":"Good","custodian_person_id":2,"data_owner_user_id":null,"deleted_at":null,"department":"Enterprise Infrastructure","division_id":2,"id":8,"location_id":2,"pic_id":2,"responsible_division_id":2,"verification_officer_user_id":null}', 'bab9fd28cbffa482e2a40c9da883931ae3fb428cc095188053d797190ac05b1c', '8ee7efbf4e05330850d7c8cf990f3312496e8b002f2990536f54a25839ed4754', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (9, '3bddfb50-867c-46f3-ace8-2d538748c2e1', 1, 9, 9, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '9', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000009","asset_name":"Modera Executive Modular Desk 180cm","asset_status":"Active","company_id":1,"condition_status":"Good","custodian_person_id":null,"data_owner_user_id":null,"deleted_at":null,"department":"Facility & Asset Control","division_id":1,"id":9,"location_id":1,"pic_id":null,"responsible_division_id":1,"verification_officer_user_id":null}', '8ee7efbf4e05330850d7c8cf990f3312496e8b002f2990536f54a25839ed4754', '6ebd438b15e34376e4474bcc04c7c3fb142b6b39af7eaeeb8b2689a29ad7e07d', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (10, 'f7637e02-56bf-4d1d-885a-8684c97e8251', 1, 10, NULL, 'BASELINE_SNAPSHOT', NULL, 'system', 'asset', '10', 'Initial baseline snapshot for immutable asset event ledger', NULL, '{"approver_user_id":null,"asset_code":"OIMS-2027-000010","asset_name":"HP LaserJet Pro M404dn Legacy Printer","asset_status":"Active","company_id":1,"condition_status":"Unserviceable","custodian_person_id":5,"data_owner_user_id":null,"deleted_at":null,"department":"Compliance & Risk","division_id":5,"id":10,"location_id":1,"pic_id":5,"responsible_division_id":5,"verification_officer_user_id":null}', '6ebd438b15e34376e4474bcc04c7c3fb142b6b39af7eaeeb8b2689a29ad7e07d', '0c06c4b40fdafec146e7ac08680c92d38532fb79ce18e1519bbb847b48b12658', '2026-11-26 12:34:25');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (11, 'afba4268-7272-4875-be74-38944cf44fb8', 1, 1, 1, 'QR_PRIVACY_UPDATED', 1, 'admin', 'asset_qr', '1', 'QR public visibility / expiration updated', '{"expires_at":null,"public_enabled":1,"public_show_location":1,"public_show_photo":1}', '{"expires_at":null,"public_enabled":0,"public_show_location":1,"public_show_photo":1}', '0c06c4b40fdafec146e7ac08680c92d38532fb79ce18e1519bbb847b48b12658', '95507af22d432d097ef3daff27746d6fc6fccdbf83ec8d4ba0ad5c649cbcd682', '2026-11-26 13:39:39');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (12, 'c37c51a7-7523-4424-a2bc-f863b6ad9e91', 1, 1, 1, 'QR_PRIVACY_UPDATED', 1, 'admin', 'asset_qr', '1', 'QR public visibility / expiration updated', '{"expires_at":null,"public_enabled":0,"public_show_location":1,"public_show_photo":1}', '{"expires_at":"2020-01-01T00:00:00Z","public_enabled":1,"public_show_location":1,"public_show_photo":1}', '95507af22d432d097ef3daff27746d6fc6fccdbf83ec8d4ba0ad5c649cbcd682', 'f1308569e96a920d3e2f1c2db4420e41896f879859ff49a1d22eeb9d6c631080', '2026-11-26 13:39:39');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (13, 'c0a916b0-646c-41b7-a992-2f6cde9099e4', 1, 1, 1, 'QR_PRIVACY_UPDATED', 1, 'admin', 'asset_qr', '1', 'QR public visibility / expiration updated', '{"expires_at":"2020-01-01T00:00:00Z","public_enabled":1,"public_show_location":1,"public_show_photo":1}', '{"expires_at":null,"public_enabled":1,"public_show_location":1,"public_show_photo":1}', 'f1308569e96a920d3e2f1c2db4420e41896f879859ff49a1d22eeb9d6c631080', '98e50692ed08bb9503d6307b56b1f50ea543f89cdfb4c3f41d70c5dee4d54ffe', '2026-11-26 13:39:39');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (14, '495cc782-5f17-41de-b121-1fe0bde699a9', 1, 2, 2, 'QR_REVOKED', 1, 'admin', 'asset_qr', '2', 'Label damaged', '{"qr_token":"OIMS-QR-9130619B8A58DAA4","status":"Active"}', '{"qr_token":"OIMS-QR-9130619B8A58DAA4","status":"Revoked"}', '98e50692ed08bb9503d6307b56b1f50ea543f89cdfb4c3f41d70c5dee4d54ffe', 'f7a83957be77bbcb16be63a364f447dc0d414b5a5c973fb531a424dab4976561', '2026-11-26 13:39:39');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (15, '793675dc-8a2b-4532-bfcc-9ae34688d4fc', 1, 2, 2, 'QR_REPLACED', 1, 'admin', 'asset_qr', '2', 'Replacement printed', '{"public_slug":"OgrndevI1KCeFTVK","qr_token":"OIMS-QR-9130619B8A58DAA4","status":"Revoked"}', '{"public_slug":"vldcLCA3c08UNVdg","qr_token":"OIMS-QR-E46DC39032B8E8D6","status":"Active"}', 'f7a83957be77bbcb16be63a364f447dc0d414b5a5c973fb531a424dab4976561', '19a34dad6833cca79cbab058b3f23a6d0ae684f35c891c0c161d735002ffa339', '2026-11-26 13:39:39');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (16, 'c64dfbb1-fc8a-4021-8f3a-f1dab374506c', 1, 1, 1, 'GPS_RECORDED', 3, 'pic.budi', 'field_capture', '1', 'Verified at HO Lobby', NULL, '{"accuracy_meters":8,"condition_observed":"Good","latitude":-1.868912,"longitude":115.968245}', '19a34dad6833cca79cbab058b3f23a6d0ae684f35c891c0c161d735002ffa339', '4baa5528e1fe83c1e6815ca8c919a33a09d6cd83edda4a1446853fdbf814e621', '2026-11-26 13:39:39');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (17, 'cda28934-a2c8-4f2a-8ee2-26e23958c076', 1, 6, 6, 'GPS_RECORDED', 1, 'admin', 'opname', 'OPN-2027-Q4-01', 'GPS recorded during Stock Opname OPN-2027-Q4-01', NULL, '{"accuracy_meters":10,"latitude":-1.8691,"longitude":115.9685}', '4baa5528e1fe83c1e6815ca8c919a33a09d6cd83edda4a1446853fdbf814e621', '7948534563662bc615c7a64fda4e8b79c0675ebfb1a4f1e5a04c9dbb67e21640', '2026-11-26 13:39:39');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (18, '9252a923-62c1-485a-abde-bf12d053f79e', 1, 6, 6, 'ASSET_VERIFIED', 1, 'admin', 'opname', 'OPN-2027-Q4-01', 'Stock Opname verification result: Verified', '{"condition_status":"Major Damage","location_id":2}', '{"actual_condition":"Major Damage","actual_location_id":2,"detail_id":4,"opname_id":1,"verification_result":"Verified"}', '7948534563662bc615c7a64fda4e8b79c0675ebfb1a4f1e5a04c9dbb67e21640', 'f3d63cc81ba1a924a4abb7b3bf8dc4ddd5d15037810a1626df235fb75810f0ea', '2026-11-26 13:39:39');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (19, '10334ea1-e70f-4ae6-88c9-e9f85b75217e', 1, 1, 1, 'QR_PRIVACY_UPDATED', 1, 'admin', 'asset_qr', '1', 'QR public visibility / expiration updated', '{"expires_at":null,"public_enabled":1,"public_show_location":1,"public_show_photo":1}', '{"expires_at":null,"public_enabled":0,"public_show_location":1,"public_show_photo":1}', 'f3d63cc81ba1a924a4abb7b3bf8dc4ddd5d15037810a1626df235fb75810f0ea', 'bf982f21c81c60086b60f05407aa24d9e2e063c981786f6cc71e0d75bc41e50d', '2026-11-26 13:40:03');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (20, '97f509a1-f4f4-45b8-acbb-41e8517bf0a7', 1, 1, 1, 'QR_PRIVACY_UPDATED', 1, 'admin', 'asset_qr', '1', 'QR public visibility / expiration updated', '{"expires_at":null,"public_enabled":0,"public_show_location":1,"public_show_photo":1}', '{"expires_at":"2020-01-01T00:00:00Z","public_enabled":1,"public_show_location":1,"public_show_photo":1}', 'bf982f21c81c60086b60f05407aa24d9e2e063c981786f6cc71e0d75bc41e50d', '6a87be8b79978591c50bde15bdc4af858554294b6d0bdbe5efd847c48f6da612', '2026-11-26 13:40:03');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (21, 'f8fbc35e-ddb3-4a12-af02-c5e42bac0a84', 1, 1, 1, 'QR_PRIVACY_UPDATED', 1, 'admin', 'asset_qr', '1', 'QR public visibility / expiration updated', '{"expires_at":"2020-01-01T00:00:00Z","public_enabled":1,"public_show_location":1,"public_show_photo":1}', '{"expires_at":null,"public_enabled":1,"public_show_location":1,"public_show_photo":1}', '6a87be8b79978591c50bde15bdc4af858554294b6d0bdbe5efd847c48f6da612', 'd903d98b71e3d0d2df2560096f39507ce76a81f8174422cd779b095116b1ceab', '2026-11-26 13:40:03');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (22, '80c05303-3556-4535-9f51-c91e24567ea7', 1, 2, 2, 'QR_REVOKED', 1, 'admin', 'asset_qr', '2', 'Label damaged', '{"qr_token":"OIMS-QR-E46DC39032B8E8D6","status":"Active"}', '{"qr_token":"OIMS-QR-E46DC39032B8E8D6","status":"Revoked"}', 'd903d98b71e3d0d2df2560096f39507ce76a81f8174422cd779b095116b1ceab', '911778617963fd11d10f3d1ae313af71d3b5f205be22d079d85aa51acc6a4010', '2026-11-26 13:40:03');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (23, '0f7d55e7-6072-4444-a9ce-2da51a03b24b', 1, 2, 2, 'QR_REPLACED', 1, 'admin', 'asset_qr', '2', 'Replacement printed', '{"public_slug":"vldcLCA3c08UNVdg","qr_token":"OIMS-QR-E46DC39032B8E8D6","status":"Revoked"}', '{"public_slug":"P1xnul5oCg3zN0i4","qr_token":"OIMS-QR-23E137BEF94957FF","status":"Active"}', '911778617963fd11d10f3d1ae313af71d3b5f205be22d079d85aa51acc6a4010', 'a3e97b237230c4fe4fd0639e967007d983e253879875e50bc52816d9b75fb399', '2026-11-26 13:40:03');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (24, '34a5217d-afd3-44d7-8717-931a40133daf', 1, 1, 1, 'GPS_RECORDED', 3, 'pic.budi', 'field_capture', '3', 'Verified at HO Lobby', NULL, '{"accuracy_meters":8,"condition_observed":"Good","latitude":-1.868912,"longitude":115.968245}', 'a3e97b237230c4fe4fd0639e967007d983e253879875e50bc52816d9b75fb399', '190875782dc916dd0d61c1820838e02c03c138b66e0edfa75da1bf2d39478774', '2026-11-26 13:40:03');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (25, 'd927be3c-0f45-4aaa-9130-354ac96f55d5', 1, 6, 6, 'GPS_RECORDED', 1, 'admin', 'opname', 'OPN-2027-Q4-01', 'GPS recorded during Stock Opname OPN-2027-Q4-01', NULL, '{"accuracy_meters":10,"latitude":-1.8691,"longitude":115.9685}', '190875782dc916dd0d61c1820838e02c03c138b66e0edfa75da1bf2d39478774', '99a4347016d6b25fe3706041daabc98bafa013ebe6b53b361a4ba549bef119e0', '2026-11-26 13:40:03');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (26, '98a99c47-89ba-4256-9e68-6a0110e7df5b', 1, 6, 6, 'ASSET_VERIFIED', 1, 'admin', 'opname', 'OPN-2027-Q4-01', 'Stock Opname verification result: Condition Mismatch', '{"condition_status":"Major Damage","location_id":2}', '{"actual_condition":"Unserviceable","actual_location_id":2,"detail_id":5,"opname_id":1,"verification_result":"Condition Mismatch"}', '99a4347016d6b25fe3706041daabc98bafa013ebe6b53b361a4ba549bef119e0', '129c98c8e02c3e62e686782cfae92fdde50a23e998dd0d31fb612fd19df4e6cc', '2026-11-26 13:40:03');
INSERT INTO `asset_events` (`id`, `event_uuid`, `company_id`, `asset_id`, `qr_id`, `event_type`, `actor_user_id`, `actor_username`, `reference_type`, `reference_id`, `reason`, `previous_state_json`, `new_state_json`, `prev_hash`, `event_hash`, `created_at`) VALUES (27, 'e1bc1bcd-d3ac-4a7e-9425-6c098322c1b6', 1, 6, NULL, 'CONDITION_CHANGED', 1, 'admin', 'reconciliation', 'REC-2026-ABA6D5', 'Authorized reconciliation update: Authorized condition update after maintenance inspection', '{"approver_user_id":null,"asset_code":"OIMS-2027-000006","asset_name":"APC Smart-UPS 3000VA Rackmount","asset_status":"In Maintenance","company_id":1,"condition_status":"Major Damage","custodian_person_id":2,"data_owner_user_id":null,"deleted_at":null,"department":"Enterprise Infrastructure","division_id":2,"id":6,"location_id":2,"pic_id":2,"responsible_division_id":2,"verification_officer_user_id":null}', '{"approver_user_id":null,"asset_code":"OIMS-2027-000006","asset_name":"APC Smart-UPS 3000VA Rackmount","asset_status":"In Maintenance","company_id":1,"condition_status":"Unserviceable","custodian_person_id":2,"data_owner_user_id":null,"deleted_at":null,"department":"Enterprise Infrastructure","division_id":2,"id":6,"location_id":2,"pic_id":2,"responsible_division_id":2,"verification_officer_user_id":null}', '129c98c8e02c3e62e686782cfae92fdde50a23e998dd0d31fb612fd19df4e6cc', '95438e1b11adfac5d538fda67334d7804fb47422815e2aca45b27fcc4a49c715', '2026-11-26 13:40:03');

-- Data for `qr_access_logs`
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (1, NULL, NULL, 'OIMS-2027-000001', 'denied', 'not_found', NULL, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (2, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (3, 1, 1, 'od9oI8W_UIKOu67I', 'denied', 'public_disabled', NULL, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (4, 1, 1, 'od9oI8W_UIKOu67I', 'denied', 'expired', NULL, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (5, 2, 2, 'OgrndevI1KCeFTVK', 'denied', 'revoked', NULL, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (6, NULL, NULL, 'OgrndevI1KCeFTVK', 'denied', 'not_found', NULL, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (7, 2, 2, 'vldcLCA3c08UNVdg', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (8, 1, 1, 'OIMS-QR-70F93BDC28443E74', 'authenticated', 'granted', 3, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (9, 1, 1, 'OIMS-QR-70F93BDC28443E74', 'administrative', 'granted', 1, '127.0.0.1', 'node', '2026-11-26 13:39:39');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (10, NULL, NULL, 'OIMS-2027-000001', 'denied', 'not_found', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (11, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (12, 1, 1, 'od9oI8W_UIKOu67I', 'denied', 'public_disabled', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (13, 1, 1, 'od9oI8W_UIKOu67I', 'denied', 'expired', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (14, 2, 2, 'vldcLCA3c08UNVdg', 'denied', 'revoked', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (15, NULL, NULL, 'vldcLCA3c08UNVdg', 'denied', 'not_found', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (16, 2, 2, 'P1xnul5oCg3zN0i4', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (17, 1, 1, 'OIMS-QR-70F93BDC28443E74', 'authenticated', 'granted', 3, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (18, 1, 1, 'OIMS-QR-70F93BDC28443E74', 'administrative', 'granted', 1, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (19, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (20, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (21, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (22, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (23, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (24, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (25, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (26, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (27, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (28, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (29, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (30, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (31, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (32, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (33, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (34, 1, 1, 'od9oI8W_UIKOu67I', 'public', 'granted', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');
INSERT INTO `qr_access_logs` (`id`, `qr_id`, `asset_id`, `token_attempted`, `access_tier`, `outcome`, `user_id`, `ip_address`, `user_agent`, `created_at`) VALUES (35, NULL, NULL, 'od9oI8W_UIKOu67I', 'denied', 'rate_limited', NULL, '127.0.0.1', 'node', '2026-11-26 13:40:03');

-- Data for `asset_field_captures`
INSERT INTO `asset_field_captures` (`id`, `company_id`, `asset_id`, `qr_id`, `opname_id`, `captured_by_user_id`, `capture_context`, `latitude`, `longitude`, `accuracy_meters`, `photo_url`, `condition_observed`, `notes`, `captured_at`) VALUES (1, 1, 1, 1, NULL, 3, 'field_scan', -1.868912, 115.968245, 8, NULL, 'Good', 'Verified at HO Lobby', '2026-11-26 13:39:39');
INSERT INTO `asset_field_captures` (`id`, `company_id`, `asset_id`, `qr_id`, `opname_id`, `captured_by_user_id`, `capture_context`, `latitude`, `longitude`, `accuracy_meters`, `photo_url`, `condition_observed`, `notes`, `captured_at`) VALUES (2, 1, 6, 6, 1, 1, 'stock_opname', -1.8691, 115.9685, 10, NULL, 'Major Damage', 'Battery fault confirmed in field', '2026-11-26 13:39:39');
INSERT INTO `asset_field_captures` (`id`, `company_id`, `asset_id`, `qr_id`, `opname_id`, `captured_by_user_id`, `capture_context`, `latitude`, `longitude`, `accuracy_meters`, `photo_url`, `condition_observed`, `notes`, `captured_at`) VALUES (3, 1, 1, 1, NULL, 3, 'field_scan', -1.868912, 115.968245, 8, NULL, 'Good', 'Verified at HO Lobby', '2026-11-26 13:40:03');
INSERT INTO `asset_field_captures` (`id`, `company_id`, `asset_id`, `qr_id`, `opname_id`, `captured_by_user_id`, `capture_context`, `latitude`, `longitude`, `accuracy_meters`, `photo_url`, `condition_observed`, `notes`, `captured_at`) VALUES (4, 1, 6, 6, 1, 1, 'stock_opname', -1.8691, 115.9685, 10, NULL, 'Unserviceable', 'UPS unit failure confirmed in field', '2026-11-26 13:40:03');

-- Data for `asset_reconciliation_findings`
INSERT INTO `asset_reconciliation_findings` (`id`, `finding_code`, `company_id`, `opname_id`, `asset_id`, `scanned_code`, `reconciliation_status`, `priority`, `title`, `discrepancy_summary`, `expected_snapshot_json`, `observed_snapshot_json`, `evidence_photo_url`, `gps_latitude`, `gps_longitude`, `assigned_to_user_id`, `resolution_status`, `resolution_notes`, `master_updated`, `resolved_by_user_id`, `resolved_at`, `created_at`, `updated_at`) VALUES (1, 'REC-2026-71CA93', 1, 1, 1, 'OIMS-2027-000001', 'INCOMPLETE_DATA', 'Low', 'OIMS-2027-000001 · Incomplete Master Asset Data', 'Missing governance/identification attributes: data_owner.', '{"asset_code":"OIMS-2027-000001","location_id":2,"location":"KIDECO Office Building (Graha Mitra) · Rack & Workstation Bay 2","condition_status":"Good","asset_status":"Active","serial_number":"DL7450-KDC-9921A"}', '{"missingFields":["data_owner"]}', NULL, -1.868912, 115.968245, NULL, 'Open', NULL, 0, NULL, NULL, '2026-11-26 13:39:39', '2026-11-26 13:40:03');
INSERT INTO `asset_reconciliation_findings` (`id`, `finding_code`, `company_id`, `opname_id`, `asset_id`, `scanned_code`, `reconciliation_status`, `priority`, `title`, `discrepancy_summary`, `expected_snapshot_json`, `observed_snapshot_json`, `evidence_photo_url`, `gps_latitude`, `gps_longitude`, `assigned_to_user_id`, `resolution_status`, `resolution_notes`, `master_updated`, `resolved_by_user_id`, `resolved_at`, `created_at`, `updated_at`) VALUES (2, 'REC-2026-27610F', 1, 1, 6, 'OIMS-2027-000006', 'DUPLICATE_SUSPECTED', 'Critical', 'OIMS-2027-000006 · Duplicate Serial / Repeated Scan Suspected', 'Scanned 3 times in opname OPN-2027-Q4-01.', '{"asset_code":"OIMS-2027-000006","location_id":2,"location":"KIDECO Office Building (Graha Mitra) · Rack & Workstation Bay 2","condition_status":"Major Damage","asset_status":"In Maintenance","serial_number":"APC-3K-192044"}', '{"duplicate_count":3}', NULL, -1.8691, 115.9685, NULL, 'Open', NULL, 0, NULL, NULL, '2026-11-26 13:39:39', '2026-11-26 13:40:03');
INSERT INTO `asset_reconciliation_findings` (`id`, `finding_code`, `company_id`, `opname_id`, `asset_id`, `scanned_code`, `reconciliation_status`, `priority`, `title`, `discrepancy_summary`, `expected_snapshot_json`, `observed_snapshot_json`, `evidence_photo_url`, `gps_latitude`, `gps_longitude`, `assigned_to_user_id`, `resolution_status`, `resolution_notes`, `master_updated`, `resolved_by_user_id`, `resolved_at`, `created_at`, `updated_at`) VALUES (3, 'REC-2026-69EFBB', 1, 1, 6, 'OIMS-2027-000006', 'INCOMPLETE_DATA', 'Low', 'OIMS-2027-000006 · Incomplete Master Asset Data', 'Missing governance/identification attributes: photo, data_owner.', '{"asset_code":"OIMS-2027-000006","location_id":2,"location":"KIDECO Office Building (Graha Mitra) · Rack & Workstation Bay 2","condition_status":"Major Damage","asset_status":"In Maintenance","serial_number":"APC-3K-192044"}', '{"missingFields":["photo","data_owner"]}', NULL, -1.8691, 115.9685, NULL, 'Open', NULL, 0, NULL, NULL, '2026-11-26 13:39:39', '2026-11-26 13:40:03');
INSERT INTO `asset_reconciliation_findings` (`id`, `finding_code`, `company_id`, `opname_id`, `asset_id`, `scanned_code`, `reconciliation_status`, `priority`, `title`, `discrepancy_summary`, `expected_snapshot_json`, `observed_snapshot_json`, `evidence_photo_url`, `gps_latitude`, `gps_longitude`, `assigned_to_user_id`, `resolution_status`, `resolution_notes`, `master_updated`, `resolved_by_user_id`, `resolved_at`, `created_at`, `updated_at`) VALUES (4, 'REC-2026-C5E08E', 1, 1, 8, 'OIMS-2027-000008', 'INCOMPLETE_DATA', 'Low', 'OIMS-2027-000008 · Incomplete Master Asset Data', 'Missing governance/identification attributes: photo, data_owner.', '{"asset_code":"OIMS-2027-000008","location_id":2,"location":"KIDECO Office Building (Graha Mitra) · Rack & Workstation Bay 2","condition_status":"Good","asset_status":"Active","serial_number":"CSC-9200-55019"}', '{"missingFields":["photo","data_owner"]}', NULL, NULL, NULL, NULL, 'Open', NULL, 0, NULL, NULL, '2026-11-26 13:39:39', '2026-11-26 13:40:03');
INSERT INTO `asset_reconciliation_findings` (`id`, `finding_code`, `company_id`, `opname_id`, `asset_id`, `scanned_code`, `reconciliation_status`, `priority`, `title`, `discrepancy_summary`, `expected_snapshot_json`, `observed_snapshot_json`, `evidence_photo_url`, `gps_latitude`, `gps_longitude`, `assigned_to_user_id`, `resolution_status`, `resolution_notes`, `master_updated`, `resolved_by_user_id`, `resolved_at`, `created_at`, `updated_at`) VALUES (5, 'REC-2026-ABA6D5', 1, 1, 6, 'OIMS-2027-000006', 'CONDITION_MISMATCH', 'High', 'OIMS-2027-000006 · Physical Condition Mismatch', 'Master condition is "Major Damage", field observation reported "Unserviceable".', '{"asset_code":"OIMS-2027-000006","location_id":2,"location":"KIDECO Office Building (Graha Mitra) · Rack & Workstation Bay 2","condition_status":"Major Damage","asset_status":"In Maintenance","serial_number":"APC-3K-192044"}', '{"actual_condition":"Unserviceable"}', NULL, -1.8691, 115.9685, NULL, 'Resolved', 'Authorized condition update after maintenance inspection', 1, 1, '2026-11-26 13:40:03', '2026-11-26 13:40:03', '2026-11-26 13:40:03');

-- Data for `retention_policies`
INSERT INTO `retention_policies` (`id`, `policy_code`, `record_class`, `title`, `description`, `retention_days`, `action_mode`, `is_immutable_ledger`, `is_active`, `last_evaluated_at`, `updated_by`, `created_at`, `updated_at`) VALUES (1, 'RET-LEDGER-01', 'asset_events', 'Immutable Asset Event Ledger (SHA-256)', 'Riwayat event aset hash-chained bersifat permanen dan tidak pernah dihapus atau dimodifikasi oleh proses retensi.', 3650, 'immutable_retain', 1, 1, '2026-11-27 08:11:27', NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');
INSERT INTO `retention_policies` (`id`, `policy_code`, `record_class`, `title`, `description`, `retention_days`, `action_mode`, `is_immutable_ledger`, `is_active`, `last_evaluated_at`, `updated_by`, `created_at`, `updated_at`) VALUES (2, 'RET-AUDIT-01', 'audit_logs', 'Security Audit Trail Logs', 'Log autentikasi, otorisasi, dan perubahan kebijakan keamanan sistem dipertahankan permanen untuk kepatuhan.', 3650, 'immutable_retain', 1, 1, '2026-11-27 08:11:27', NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');
INSERT INTO `retention_policies` (`id`, `policy_code`, `record_class`, `title`, `description`, `retention_days`, `action_mode`, `is_immutable_ledger`, `is_active`, `last_evaluated_at`, `updated_by`, `created_at`, `updated_at`) VALUES (3, 'RET-DISP-01', 'disposed_assets', 'Disposed Assets Archive', 'Aset berstatus Disposed yang melewati masa retensi diarsipkan (archived_at) selama tidak berstatus Legal Hold.', 1825, 'archive_record', 0, 1, '2026-11-27 08:11:27', NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');
INSERT INTO `retention_policies` (`id`, `policy_code`, `record_class`, `title`, `description`, `retention_days`, `action_mode`, `is_immutable_ledger`, `is_active`, `last_evaluated_at`, `updated_by`, `created_at`, `updated_at`) VALUES (4, 'RET-QR-01', 'qr_access_logs', 'QR Public & Scan Access Telemetry', 'Log telemetri akses QR non-ledger yang melampaui masa retensi dapat dipangkas secara terkontrol.', 365, 'purge_non_ledger', 0, 1, '2026-11-27 08:11:27', NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');
INSERT INTO `retention_policies` (`id`, `policy_code`, `record_class`, `title`, `description`, `retention_days`, `action_mode`, `is_immutable_ledger`, `is_active`, `last_evaluated_at`, `updated_by`, `created_at`, `updated_at`) VALUES (5, 'RET-FIELD-01', 'asset_field_captures', 'Field Capture Photo & GPS Evidence', 'Bukti foto lapangan dan koordinat GPS inspeksi disimpan sebagai arsip verifikasi historis.', 1095, 'archive_record', 0, 1, '2026-11-27 08:11:27', NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');
INSERT INTO `retention_policies` (`id`, `policy_code`, `record_class`, `title`, `description`, `retention_days`, `action_mode`, `is_immutable_ledger`, `is_active`, `last_evaluated_at`, `updated_by`, `created_at`, `updated_at`) VALUES (6, 'RET-SOP-01', 'sop_executions', 'SOP Operational Sign-off Records', 'Catatan kepatuhan dan deviasi SOP operasional lintas modul.', 1825, 'archive_record', 0, 1, '2026-11-27 08:11:27', NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');
INSERT INTO `retention_policies` (`id`, `policy_code`, `record_class`, `title`, `description`, `retention_days`, `action_mode`, `is_immutable_ledger`, `is_active`, `last_evaluated_at`, `updated_by`, `created_at`, `updated_at`) VALUES (7, 'RET-AI-01', 'ai_asset_identifications', 'Smart AI Extraction & Verification Queue', 'Rekam jejak rekomendasi OCR/deduplikasi AI dan keputusan verifikasi manusia.', 730, 'archive_record', 0, 1, '2026-11-27 08:11:27', NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');

-- Data for `enterprise_sops`
INSERT INTO `enterprise_sops` (`id`, `sop_code`, `company_id`, `title`, `category`, `version`, `mandatory_module`, `checklist_json`, `is_mandatory`, `is_active`, `created_by`, `created_at`, `updated_at`) VALUES (1, 'SOP-OIMS-001', NULL, 'Registrasi Aset Baru & Penandaan QR Fisik', 'Asset Onboarding', '2.1', 'register', '["Verifikasi faktur / PO pengadaan dan nilai perolehan","Pastikan nomor seri pabrikan tercatat akurat tanpa duplikasi","Tetapkan Penanggung Jawab (PIC) dan Divisi pemilik aset","Tempelkan label QR unik pada bodi aset dan unggah foto dokumentasi"]', 1, 1, NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');
INSERT INTO `enterprise_sops` (`id`, `sop_code`, `company_id`, `title`, `category`, `version`, `mandatory_module`, `checklist_json`, `is_mandatory`, `is_active`, `created_by`, `created_at`, `updated_at`) VALUES (2, 'SOP-OIMS-002', NULL, 'Audit Fisik Lapangan & Rekonsiliasi Stock Opname', 'Field Audit & Reconciliation', '2.0', 'opname', '["Pindai QR token atau nomor seri aktual di lokasi fisik","Rekam foto kondisi terkini beserta koordinat GPS verifikasi","Catat temuan ketidaksesuaian ke Reconciliation Engine (tanpa menimpa master otomatis)","Lakukan peninjauan supervisor sebelum otorisasi pembaruan master"]', 1, 1, NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');
INSERT INTO `enterprise_sops` (`id`, `sop_code`, `company_id`, `title`, `category`, `version`, `mandatory_module`, `checklist_json`, `is_mandatory`, `is_active`, `created_by`, `created_at`, `updated_at`) VALUES (3, 'SOP-OIMS-003', NULL, 'Persetujuan Perpindahan Lintas Perusahaan & Disposal', 'Custody & Disposal Control', '1.4', 'movements', '["Ajukan permohonan transfer resmi beserta berita acara serah terima","Dapatkan persetujuan approver lintas entitas sebelum memindahkan fisik aset","Pastikan status Legal Hold tidak aktif sebelum proses arsip atau disposal"]', 1, 1, NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');

-- Data for `integration_connectors`
INSERT INTO `integration_connectors` (`id`, `connector_code`, `company_id`, `name`, `connector_type`, `endpoint_url`, `auth_scheme`, `env_secret_ref`, `data_classification`, `is_enabled`, `last_test_status`, `last_tested_at`, `updated_by`, `created_at`, `updated_at`) VALUES (1, 'ERP-SAP-SYNC', NULL, 'SAP S/4HANA Fixed Asset Ledger Sync', 'erp_sync', 'https://erp-gateway.kideco.internal/api/v1/fixed-assets/sync', 'Bearer Env', 'KIDECO_ERP_API_TOKEN', 'Confidential', 0, 'DryRun OK', '2026-11-27 08:11:27', NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:27');
INSERT INTO `integration_connectors` (`id`, `connector_code`, `company_id`, `name`, `connector_type`, `endpoint_url`, `auth_scheme`, `env_secret_ref`, `data_classification`, `is_enabled`, `last_test_status`, `last_tested_at`, `updated_by`, `created_at`, `updated_at`) VALUES (2, 'HRIS-EMP-SYNC', NULL, 'Corporate HRIS Employee & PIC Directory Sync', 'hris_sync', 'https://hris.kideco.internal/api/v1/employees/directory', 'HMAC Header', 'KIDECO_HRIS_HMAC_SECRET', 'Internal', 0, NULL, NULL, NULL, '2026-11-27 08:11:06', '2026-11-27 08:11:06');

-- Data for `bcp_runbooks`
INSERT INTO `bcp_runbooks` (`id`, `runbook_code`, `title`, `scenario`, `rto_target_minutes`, `rpo_target_minutes`, `owner_role`, `steps_json`, `last_tested_at`, `last_test_status`, `updated_by`, `updated_at`) VALUES (1, 'BCP-OIMS-001', 'Pemulihan Kerusakan Database & Verifikasi Rantai Event', 'db_corruption', 30, 15, 'Super Administrator / DBA', '["Hentikan penulisan aplikasi sementara (maintenance window) dan amankan salinan oims.db + WAL + SHM.","Jalankan PRAGMA integrity_check dan validasi SHA-256 Asset Event Ledger.","Jika korup, lakukan uji dry-run snapshot JSON terakhir sebelum memulihkan di lingkungan terpisah.","Pulihkan snapshot terverifikasi atau impor ulang oims.sql ke instansi cadangan, lalu uji login & hash chain."]', NULL, 'Not Tested', NULL, '2026-11-27 08:25:08');
INSERT INTO `bcp_runbooks` (`id`, `runbook_code`, `title`, `scenario`, `rto_target_minutes`, `rpo_target_minutes`, `owner_role`, `steps_json`, `last_tested_at`, `last_test_status`, `updated_by`, `updated_at`) VALUES (2, 'BCP-OIMS-002', 'Pemulihan Repositori Foto Aset & Dokumen Lokal', 'storage_loss', 60, 30, 'Infrastructure / Storage Lead', '["Verifikasi kapasitas disk server dan izin tulis direktori /uploads/photos, /uploads/docs, /uploads/field.","Sinkronkan ulang berkas lampiran dari backup penyimpanan harian server (rsync / volume snapshot).","Jalankan pemeriksaan integritas foto lokal di modul Health Monitoring untuk memastikan tidak ada tautan foto yatim."]', NULL, 'Not Tested', NULL, '2026-11-27 08:24:16');
INSERT INTO `bcp_runbooks` (`id`, `runbook_code`, `title`, `scenario`, `rto_target_minutes`, `rpo_target_minutes`, `owner_role`, `steps_json`, `last_tested_at`, `last_test_status`, `updated_by`, `updated_at`) VALUES (3, 'BCP-OIMS-003', 'Failover Host Aplikasi & Verifikasi Kesiapan Produksi', 'server_failover', 45, 15, 'Enterprise Systems Lead', '["Siapkan host cadangan dengan variabel environment server (passcode admin, secret sesi, opsi SMTP jika dipakai).","Deploy paket build produksi beserta direktori data/ dan uploads/ dari backup terakhir.","Jalankan Enterprise Quality Gate dan catat waktu pemulihan aktual (RTO) ke log BCP."]', NULL, 'Not Tested', NULL, '2026-11-27 08:24:16');

-- Data for `system_settings`
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('company_name', 'KIDECO', 'branding', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('company_subtitle', 'Member of Indika Energy Group', 'branding', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('company_logo_url', '/assets/aistudio/logo_795e174b.png', 'branding', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('asset_code_prefix', 'OIMS', 'assets', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('replacement_age_warning_pct', '80', 'replacement', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('replacement_age_urgent_pct', '100', 'replacement', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('replacement_cost_ratio_pct', '40', 'replacement', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('notify_missing_qr', '{"enabled":true,"priority":"Medium"}', 'notifications', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('notify_missing_pic', '{"enabled":true,"priority":"High"}', 'notifications', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('notify_damaged_asset', '{"enabled":true,"priority":"High"}', 'notifications', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('notify_pending_movement', '{"enabled":true,"priority":"Medium"}', 'notifications', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('notify_open_maintenance', '{"enabled":true,"priority":"High"}', 'notifications', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('notify_opname_mismatch', '{"enabled":true,"priority":"Critical"}', 'notifications', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('notify_replacement_due', '{"enabled":true,"priority":"High"}', 'notifications', '2026-11-26 12:34:25', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('smart_ai_enabled', 'true', 'ai_governance', '2026-11-27 08:11:27', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('smart_ai_external_allowed', 'true', 'ai_governance', '2026-11-27 08:11:06', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('bcp_rpo_target_minutes', '15', 'dr_bcp', '2026-11-27 08:24:16', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('bcp_rto_target_minutes', '60', 'dr_bcp', '2026-11-27 08:24:16', NULL);
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `category`, `updated_at`, `updated_by`) VALUES ('backup_retention_count', '14', 'dr_bcp', '2026-11-27 08:24:16', NULL);

SET FOREIGN_KEY_CHECKS = 1;