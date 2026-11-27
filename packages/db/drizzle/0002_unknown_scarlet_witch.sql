CREATE TABLE `item_barcodes` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`value` varchar(64) NOT NULL,
	CONSTRAINT `item_barcodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_item_barcodes_company_value` UNIQUE(`company_id`,`value`)
);
--> statement-breakpoint
CREATE TABLE `item_categories` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(100) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `item_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_item_categories_company_code` UNIQUE(`company_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`sku` varchar(40) NOT NULL,
	`name` varchar(200) NOT NULL,
	`category_id` char(36),
	`base_uom_id` char(36) NOT NULL,
	`item_type` varchar(16) NOT NULL DEFAULT 'goods',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_items_company_sku` UNIQUE(`company_id`,`sku`),
	CONSTRAINT `ck_items_type` CHECK(`items`.`item_type` in ('goods','service'))
);
--> statement-breakpoint
CREATE TABLE `uom_conversions` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`from_uom_id` char(36) NOT NULL,
	`to_uom_id` char(36) NOT NULL,
	`factor` decimal(19,6) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	CONSTRAINT `uom_conversions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_uom_conversions_company_from` UNIQUE(`company_id`,`from_uom_id`),
	CONSTRAINT `ck_uom_conversions_factor` CHECK(`uom_conversions`.`factor` > 0),
	CONSTRAINT `ck_uom_conversions_distinct` CHECK(`uom_conversions`.`from_uom_id` <> `uom_conversions`.`to_uom_id`)
);
--> statement-breakpoint
CREATE TABLE `uoms` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`code` varchar(10) NOT NULL,
	`name` varchar(50) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `uoms_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_uoms_company_code` UNIQUE(`company_id`,`code`)
);
--> statement-breakpoint
ALTER TABLE `item_barcodes` ADD CONSTRAINT `item_barcodes_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `item_categories` ADD CONSTRAINT `item_categories_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `items` ADD CONSTRAINT `items_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `items` ADD CONSTRAINT `items_category_id_item_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `item_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `items` ADD CONSTRAINT `items_base_uom_id_uoms_id_fk` FOREIGN KEY (`base_uom_id`) REFERENCES `uoms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `uom_conversions` ADD CONSTRAINT `uom_conversions_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `uom_conversions` ADD CONSTRAINT `uom_conversions_from_uom_id_uoms_id_fk` FOREIGN KEY (`from_uom_id`) REFERENCES `uoms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `uom_conversions` ADD CONSTRAINT `uom_conversions_to_uom_id_uoms_id_fk` FOREIGN KEY (`to_uom_id`) REFERENCES `uoms`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `uoms` ADD CONSTRAINT `uoms_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_item_barcodes_item` ON `item_barcodes` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_items_company_category` ON `items` (`company_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `idx_uom_conversions_company_to` ON `uom_conversions` (`company_id`,`to_uom_id`);