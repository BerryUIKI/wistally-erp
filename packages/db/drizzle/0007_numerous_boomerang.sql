CREATE TABLE `account_mappings` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`mapping_key` varchar(64) NOT NULL,
	`account_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `account_mappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_account_mappings_company_key` UNIQUE(`company_id`,`mapping_key`)
);
--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `source_type` varchar(24);--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `source_id` char(36);--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `source_event` varchar(32);--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `uq_journal_entries_source` UNIQUE(`company_id`,`source_type`,`source_id`,`source_event`);--> statement-breakpoint
ALTER TABLE `account_mappings` ADD CONSTRAINT `account_mappings_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `account_mappings` ADD CONSTRAINT `account_mappings_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_account_mappings_company_account` ON `account_mappings` (`company_id`,`account_id`);