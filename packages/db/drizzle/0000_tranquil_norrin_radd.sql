CREATE TABLE `companies` (
	`id` char(36) NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(200) NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
	`base_currency` char(3) NOT NULL DEFAULT 'CNY',
	`fiscal_year_start_month` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `companies_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `currencies` (
	`code` char(3) NOT NULL,
	`name` varchar(64) NOT NULL,
	`decimal_places` int NOT NULL DEFAULT 2,
	CONSTRAINT `currencies_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` char(36) NOT NULL,
	`permission_code` varchar(100) NOT NULL,
	CONSTRAINT `role_permissions_role_id_permission_code_pk` PRIMARY KEY(`role_id`,`permission_code`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_roles_company_code` UNIQUE(`company_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`ip` varchar(45),
	`user_agent` varchar(512),
	`created_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` char(36) NOT NULL,
	`role_id` char(36) NOT NULL,
	CONSTRAINT `user_roles_user_id_role_id_pk` PRIMARY KEY(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`display_name` varchar(120) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_company_email` UNIQUE(`company_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(100) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `departments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_departments_company_code` UNIQUE(`company_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `fiscal_periods` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`fiscal_year` int NOT NULL,
	`period_no` int NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'open',
	CONSTRAINT `fiscal_periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_fiscal_periods_company_year_no` UNIQUE(`company_id`,`fiscal_year`,`period_no`)
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(100) NOT NULL,
	`address` varchar(200),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `warehouses_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_warehouses_company_code` UNIQUE(`company_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`actor_id` char(36) NOT NULL,
	`action` varchar(100) NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(36),
	`before` json,
	`after` json,
	`ip` varchar(45),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_sequences` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`doc_type` varchar(64) NOT NULL,
	`period_key` varchar(32) NOT NULL,
	`prefix` varchar(16) NOT NULL,
	`next_no` int NOT NULL DEFAULT 1,
	`width` int NOT NULL DEFAULT 4,
	CONSTRAINT `document_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_document_sequences` UNIQUE(`company_id`,`doc_type`,`period_key`)
);
--> statement-breakpoint
CREATE TABLE `job_queue` (
	`id` char(36) NOT NULL,
	`name` varchar(64) NOT NULL,
	`payload` json,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`run_at` datetime(3) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 3,
	`locked_at` datetime(3),
	`locked_by` varchar(64),
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `job_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `departments` ADD CONSTRAINT `departments_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fiscal_periods` ADD CONSTRAINT `fiscal_periods_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_sequences` ADD CONSTRAINT `document_sequences_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_periods_company_year` ON `fiscal_periods` (`company_id`,`fiscal_year`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_company_created` ON `audit_logs` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_job_queue_due` ON `job_queue` (`status`,`run_at`);