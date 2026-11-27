CREATE TABLE `accounts` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` varchar(16) NOT NULL,
	`parent_id` char(36),
	`deleted_at` datetime(3),
	`code_key` varchar(20) GENERATED ALWAYS AS (if(deleted_at is null, code, null)) STORED,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_accounts_company_code` UNIQUE(`company_id`,`code_key`),
	CONSTRAINT `ck_accounts_type` CHECK(`accounts`.`type` in ('asset','liability','equity','revenue','expense')),
	CONSTRAINT `ck_accounts_code` CHECK(`accounts`.`code` regexp '^[0-9]{3,10}$')
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_parent_id_accounts_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_accounts_company_parent` ON `accounts` (`company_id`,`parent_id`);