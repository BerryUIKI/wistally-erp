CREATE TABLE `parties` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(200) NOT NULL,
	`kind` varchar(16) NOT NULL DEFAULT 'company',
	`tax_no` varchar(50),
	`credit_limit_amount` decimal(19,6) NOT NULL DEFAULT '0.000000',
	`credit_limit_currency` char(3) NOT NULL DEFAULT 'CNY',
	`payment_terms_days` int NOT NULL DEFAULT 0,
	`notes` varchar(1000),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `parties_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_parties_company_code` UNIQUE(`company_id`,`code`),
	CONSTRAINT `ck_parties_kind` CHECK(`parties`.`kind` in ('company','individual')),
	CONSTRAINT `ck_parties_credit_limit` CHECK(`parties`.`credit_limit_amount` >= 0),
	CONSTRAINT `ck_parties_payment_terms` CHECK(`parties`.`payment_terms_days` between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE `party_addresses` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`party_id` char(36) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`line1` varchar(200) NOT NULL,
	`line2` varchar(200),
	`city` varchar(100),
	`province` varchar(100),
	`postal_code` varchar(20),
	`country` varchar(64),
	`is_primary` boolean NOT NULL DEFAULT false,
	CONSTRAINT `party_addresses_id` PRIMARY KEY(`id`),
	CONSTRAINT `ck_party_addresses_kind` CHECK(`party_addresses`.`kind` in ('billing','shipping'))
);
--> statement-breakpoint
CREATE TABLE `party_contacts` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`party_id` char(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`title` varchar(100),
	`email` varchar(200),
	`phone` varchar(40),
	`is_primary` boolean NOT NULL DEFAULT false,
	CONSTRAINT `party_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `party_roles` (
	`party_id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`role` varchar(16) NOT NULL,
	CONSTRAINT `party_roles_party_id_role_pk` PRIMARY KEY(`party_id`,`role`),
	CONSTRAINT `ck_party_roles_role` CHECK(`party_roles`.`role` in ('customer','supplier'))
);
--> statement-breakpoint
ALTER TABLE `parties` ADD CONSTRAINT `parties_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `party_addresses` ADD CONSTRAINT `party_addresses_party_id_parties_id_fk` FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `party_contacts` ADD CONSTRAINT `party_contacts_party_id_parties_id_fk` FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `party_roles` ADD CONSTRAINT `party_roles_party_id_parties_id_fk` FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_party_addresses_party` ON `party_addresses` (`party_id`);--> statement-breakpoint
CREATE INDEX `idx_party_contacts_party` ON `party_contacts` (`party_id`);--> statement-breakpoint
CREATE INDEX `idx_party_roles_company_role` ON `party_roles` (`company_id`,`role`);