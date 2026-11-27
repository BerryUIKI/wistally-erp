CREATE TABLE `inventory_balances` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`warehouse_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`qty` decimal(19,6) NOT NULL DEFAULT '0',
	`total_value` decimal(19,6) NOT NULL DEFAULT '0',
	`last_unit_cost` decimal(19,6) NOT NULL DEFAULT '0',
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `inventory_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_inventory_balances_warehouse_item` UNIQUE(`company_id`,`warehouse_id`,`item_id`),
	CONSTRAINT `ck_inventory_balances_qty` CHECK(`inventory_balances`.`qty` >= 0),
	CONSTRAINT `ck_inventory_balances_value` CHECK(`inventory_balances`.`total_value` >= 0),
	CONSTRAINT `ck_inventory_balances_last_cost` CHECK(`inventory_balances`.`last_unit_cost` >= 0)
);
--> statement-breakpoint
CREATE TABLE `stock_transactions` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`warehouse_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`movement_type` varchar(16) NOT NULL,
	`qty_delta` decimal(19,6) NOT NULL,
	`unit_cost` decimal(19,6) NOT NULL,
	`amount_delta` decimal(19,6) NOT NULL,
	`balance_qty` decimal(19,6) NOT NULL,
	`balance_value` decimal(19,6) NOT NULL,
	`movement_date` date NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`source_type` varchar(24) NOT NULL,
	`source_id` char(36) NOT NULL,
	`source_line_no` int NOT NULL DEFAULT 0,
	`reason` varchar(200),
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	CONSTRAINT `stock_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_transactions_source` UNIQUE(`company_id`,`source_type`,`source_id`,`source_line_no`),
	CONSTRAINT `ck_stock_transactions_type` CHECK(`stock_transactions`.`movement_type` in ('receipt','issue')),
	CONSTRAINT `ck_stock_transactions_source_type` CHECK(`stock_transactions`.`source_type` in ('manual','transfer','stocktake','purchase_receipt','sales_shipment')),
	CONSTRAINT `ck_stock_transactions_direction` CHECK((`stock_transactions`.`movement_type` = 'receipt' and `stock_transactions`.`qty_delta` > 0 and `stock_transactions`.`amount_delta` >= 0) or (`stock_transactions`.`movement_type` = 'issue' and `stock_transactions`.`qty_delta` < 0 and `stock_transactions`.`amount_delta` <= 0)),
	CONSTRAINT `ck_stock_transactions_unit_cost` CHECK(`stock_transactions`.`unit_cost` >= 0),
	CONSTRAINT `ck_stock_transactions_balance_qty` CHECK(`stock_transactions`.`balance_qty` >= 0),
	CONSTRAINT `ck_stock_transactions_balance_value` CHECK(`stock_transactions`.`balance_value` >= 0)
);
--> statement-breakpoint
ALTER TABLE `inventory_balances` ADD CONSTRAINT `inventory_balances_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_balances` ADD CONSTRAINT `inventory_balances_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_balances` ADD CONSTRAINT `inventory_balances_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transactions` ADD CONSTRAINT `stock_transactions_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transactions` ADD CONSTRAINT `stock_transactions_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transactions` ADD CONSTRAINT `stock_transactions_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_inventory_balances_company_item` ON `inventory_balances` (`company_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_transactions_company_warehouse_item` ON `stock_transactions` (`company_id`,`warehouse_id`,`item_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_stock_transactions_company_occurred` ON `stock_transactions` (`company_id`,`occurred_at`);