CREATE TABLE `journal_entries` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`doc_no` varchar(32),
	`entry_date` date NOT NULL,
	`memo` varchar(500) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`reversal_of_id` char(36),
	`approved_at` datetime(3),
	`approved_by` char(36),
	`posted_at` datetime(3),
	`posted_by` char(36),
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `journal_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_journal_entries_company_doc` UNIQUE(`company_id`,`doc_no`),
	CONSTRAINT `ck_journal_entries_status` CHECK(`journal_entries`.`status` in ('draft','approved','posted','reversed')),
	CONSTRAINT `ck_journal_entries_doc_no` CHECK((`journal_entries`.`status` in ('draft','approved') and `journal_entries`.`doc_no` is null) or (`journal_entries`.`status` in ('posted','reversed') and `journal_entries`.`doc_no` is not null))
);
--> statement-breakpoint
CREATE TABLE `journal_entry_lines` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`journal_entry_id` char(36) NOT NULL,
	`line_no` int NOT NULL,
	`account_id` char(36) NOT NULL,
	`side` varchar(6) NOT NULL,
	`amount` decimal(19,6) NOT NULL,
	`memo` varchar(200),
	CONSTRAINT `journal_entry_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_journal_entry_lines_no` UNIQUE(`journal_entry_id`,`line_no`),
	CONSTRAINT `ck_journal_entry_lines_side` CHECK(`journal_entry_lines`.`side` in ('debit','credit')),
	CONSTRAINT `ck_journal_entry_lines_amount` CHECK(`journal_entry_lines`.`amount` <> 0)
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`journal_entry_id` char(36) NOT NULL,
	`line_no` int NOT NULL,
	`account_id` char(36) NOT NULL,
	`period_id` char(36) NOT NULL,
	`entry_date` date NOT NULL,
	`debit_amount` decimal(19,6) NOT NULL DEFAULT '0',
	`credit_amount` decimal(19,6) NOT NULL DEFAULT '0',
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	CONSTRAINT `ledger_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ledger_entries_line` UNIQUE(`journal_entry_id`,`line_no`),
	CONSTRAINT `ck_ledger_entries_one_side` CHECK((`ledger_entries`.`debit_amount` <> 0 and `ledger_entries`.`credit_amount` = 0) or (`ledger_entries`.`debit_amount` = 0 and `ledger_entries`.`credit_amount` <> 0))
);
--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_reversal_of_id_journal_entries_id_fk` FOREIGN KEY (`reversal_of_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entry_lines` ADD CONSTRAINT `journal_entry_lines_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entry_lines` ADD CONSTRAINT `journal_entry_lines_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entry_lines` ADD CONSTRAINT `journal_entry_lines_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_period_id_fiscal_periods_id_fk` FOREIGN KEY (`period_id`) REFERENCES `fiscal_periods`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_journal_entries_company_date` ON `journal_entries` (`company_id`,`entry_date`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_company_status` ON `journal_entries` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_company_reversal` ON `journal_entries` (`company_id`,`reversal_of_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_entry_lines_company_account` ON `journal_entry_lines` (`company_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `idx_ledger_entries_company_account_date` ON `ledger_entries` (`company_id`,`account_id`,`entry_date`);--> statement-breakpoint
CREATE INDEX `idx_ledger_entries_company_date` ON `ledger_entries` (`company_id`,`entry_date`);--> statement-breakpoint
CREATE INDEX `idx_ledger_entries_company_period` ON `ledger_entries` (`company_id`,`period_id`);