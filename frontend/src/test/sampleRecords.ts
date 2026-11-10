import type {
  Communication,
  Lease,
  MonitoringEvent,
  Notification,
  PaymentArrangement,
  Property,
  Statement,
  Tenant,
  Unit,
} from '@leaseguard/domain'

/**
 * TEST FIXTURES ONLY: one realistic record per kind, used as API response bodies in unit tests.
 * Never imported by application code.
 */
export interface SampleRecords {
  communications: Communication
  leases: Lease
  monitoringEvents: MonitoringEvent
  notifications: Notification
  paymentArrangements: PaymentArrangement
  properties: Property
  statements: Statement
  tenants: Tenant
  units: Unit
}

export const SAMPLE_RECORDS: SampleRecords = {
  "communications": {
    "id": "com_stmt_thrifty_2026_10",
    "companyId": "cmp_nexus",
    "createdAt": "2026-10-02T09:45:00+02:00",
    "updatedAt": "2026-10-02T10:06:00+02:00",
    "channel": "whatsapp",
    "direction": "outbound",
    "messageType": "monthly_statement",
    "recipientType": "tenant",
    "tenantId": "ten_thrifty_foods",
    "propertyId": "prop_meadowlands_square",
    "leaseId": "lease_msq_l001",
    "statementId": "stmt_msq_thrifty_2026_10",
    "templateId": "tpl_nexus_monthly_statement",
    "counterpartyNumber": "+27823341180",
    "companyNumber": "+27 11 555 0100",
    "body": "Hi Bongani, your Meadowlands Square Shopping Centre rental statement for October 2026 is attached. Closing balance: R0.00, payable by 1 Nov 2026. Reply to this message if you have a query. Nexus Solution.",
    "attachment": {
      "fileName": "MSQ-2026-10-A01-ThriftyFoods.pdf",
      "storagePath": "statements/MSQ-2026-10-A01-ThriftyFoods.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 188420,
      "sha256": "-698f1118-5afbfc62-94ad3cf342d14ba-30ffe74c-49b5ac04-314de1ec78e0dfa1"
    },
    "status": "delivered",
    "approvalId": "apr_stmt_thrifty_2026_10",
    "externalMessageId": "wamid.HBgLMjc4MjMzNDExODAVAgARGBI5QkE3RjE2RDc3RkYwRkQ4QTEA",
    "createdByUserId": "usr_sipho_dlamini",
    "sentAt": "2026-10-02T10:05:00+02:00",
    "deliveredAt": "2026-10-02T10:06:00+02:00"
  },
  "leases": {
    "id": "lease_msq_l001",
    "companyId": "cmp_nexus",
    "createdAt": "2025-01-25T09:00:00+02:00",
    "updatedAt": "2026-03-02T08:00:00+02:00",
    "reference": "MSQ-L001",
    "propertyId": "prop_meadowlands_square",
    "unitId": "unit_msq_a01",
    "tenantId": "ten_thrifty_foods",
    "commencementDate": "2023-03-01",
    "expiryDate": "2028-02-29",
    "initialMonthlyRental": 185000,
    "currentMonthlyRental": 226632.96,
    "paymentDueDay": 1,
    "escalation": {
      "type": "percentage",
      "percentage": 7,
      "frequency": "annual",
      "firstEscalationDate": "2024-03-01"
    },
    "renewalOption": {
      "exists": true,
      "renewalTermMonths": 60,
      "noticePeriodMonths": 9,
      "exercised": false,
      "notes": "Anchor tenant renewal on the same escalation terms."
    },
    "bankGuarantee": {
      "bank": "Standard Bank",
      "referenceNumber": "SBG/2023/0045812",
      "amount": 555000,
      "basisMonths": 3,
      "issuedOn": "2023-02-15",
      "expiresOn": "2028-03-31",
      "status": "active",
      "notes": "Sized at 3 months of initial rental; not topped up after escalations."
    },
    "status": "active",
    "verified": true,
    "verifiedByUserId": "usr_thandi_mokoena",
    "verifiedAt": "2025-01-28T11:20:00+02:00"
  },
  "monitoringEvents": {
    "id": "evt_escalation_pharmacare",
    "companyId": "cmp_nexus",
    "createdAt": "2026-10-02T09:53:00+02:00",
    "updatedAt": "2026-10-06T10:15:00+02:00",
    "type": "rental_escalation_discrepancy",
    "propertyId": "prop_meadowlands_square",
    "unitId": "unit_msq_s02",
    "tenantId": "ten_pharmacare_meadowlands",
    "leaseId": "lease_msq_l002",
    "leaseReference": "MSQ-L002",
    "statementId": "stmt_msq_pharmacare_2026_10",
    "ruleId": "rule_nexus_escalation",
    "title": "Rental under-charged: escalation of 1 Jun 2026 not applied",
    "description": "The October 2026 MRI statement for PharmaCare (S02) charges basic rental of R34,560.00. Lease MSQ-L002 escalates by 8% every 1 June; the contractual rental from 1 June 2026 is R37,324.80. The statement is R2,764.80 per month short and the same under-charge appears to apply from June 2026.",
    "calculation": {
      "expectedAmount": 37324.8,
      "actualAmount": 34560,
      "difference": 2764.8,
      "steps": [
        "Initial rental at commencement (1 Jun 2024): R32,000.00",
        "Escalation 1 (1 Jun 2025): R32,000.00 × 1.08 = R34,560.00",
        "Escalation 2 (1 Jun 2026): R34,560.00 × 1.08 = R37,324.80",
        "Expected rental for October 2026: R37,324.80",
        "Rental charged on statement MRI-MSQ-202610-0002: R34,560.00",
        "Difference: R37,324.80 − R34,560.00 = R2,764.80 under-charged per month",
        "Months affected (Jun–Oct 2026): 5 × R2,764.80 = R13,824.00 potentially under-billed"
      ]
    },
    "identifiedOn": "2026-10-02",
    "priority": "high",
    "recommendedAction": "Confirm the escalation clause on the signed lease, ask the MRI accounts team to correct the rental roll and raise a corrective invoice for June–October 2026. Do not message the tenant through LeaseGuard; escalation queries are handled by the property manager directly.",
    "assignedToUserId": "usr_sipho_dlamini",
    "status": "action_required"
  },
  "notifications": {
    "id": "ntf_sipho_baobab_expiry",
    "companyId": "cmp_nexus",
    "createdAt": "2026-11-01T06:01:00+02:00",
    "updatedAt": "2026-11-01T06:01:00+02:00",
    "userId": "usr_sipho_dlamini",
    "type": "monitoring_event",
    "severity": "critical",
    "title": "Lease expires in 30 days",
    "body": "KST-L004 Baobab Insurance Brokers (401) expires on 30 Nov 2026.",
    "read": false,
    "link": {
      "entityType": "monitoring_event",
      "entityId": "evt_expiry_baobab_30"
    }
  },
  "paymentArrangements": {
    "id": "arr_dlamini_2026_08",
    "companyId": "cmp_nexus",
    "createdAt": "2026-08-05T14:30:00+02:00",
    "updatedAt": "2026-10-18T08:00:00+02:00",
    "tenantId": "ten_dlamini_cellular",
    "propertyId": "prop_meadowlands_square",
    "unitId": "unit_msq_s03",
    "leaseId": "lease_msq_l003",
    "outstandingBalance": 31000,
    "installmentAmount": 6200,
    "frequency": "monthly",
    "firstInstallmentDate": "2026-08-15",
    "finalInstallmentDate": "2026-12-15",
    "status": "active",
    "suppressArrearsReminders": true,
    "agreedByUserId": "usr_sipho_dlamini",
    "agreedOn": "2026-08-05",
    "notes": "Five monthly instalments of R6,200 on the 15th, in addition to current rental. October instalment missed.",
    "installments": [
      {
        "id": "arr_dlamini_2026_08_i1",
        "arrangementId": "arr_dlamini_2026_08",
        "sequence": 1,
        "dueDate": "2026-08-15",
        "amount": 6200,
        "status": "confirmed_paid",
        "reminderSentAt": "2026-08-12T09:00:00+02:00",
        "confirmedByUserId": "usr_sipho_dlamini",
        "confirmedOn": "2026-09-02",
        "notes": "Confirmed from August statement."
      },
      {
        "id": "arr_dlamini_2026_08_i2",
        "arrangementId": "arr_dlamini_2026_08",
        "sequence": 2,
        "dueDate": "2026-09-15",
        "amount": 6200,
        "status": "confirmed_paid",
        "reminderSentAt": "2026-09-12T09:00:00+02:00",
        "confirmedByUserId": "usr_sipho_dlamini",
        "confirmedOn": "2026-10-02",
        "notes": "Confirmed from September statement."
      },
      {
        "id": "arr_dlamini_2026_08_i3",
        "arrangementId": "arr_dlamini_2026_08",
        "sequence": 3,
        "dueDate": "2026-10-15",
        "amount": 6200,
        "status": "missed",
        "reminderSentAt": "2026-10-12T09:00:00+02:00",
        "notes": "No instalment reflected on October statement."
      },
      {
        "id": "arr_dlamini_2026_08_i4",
        "arrangementId": "arr_dlamini_2026_08",
        "sequence": 4,
        "dueDate": "2026-11-15",
        "amount": 6200,
        "status": "scheduled"
      },
      {
        "id": "arr_dlamini_2026_08_i5",
        "arrangementId": "arr_dlamini_2026_08",
        "sequence": 5,
        "dueDate": "2026-12-15",
        "amount": 6200,
        "status": "scheduled"
      }
    ]
  },
  "properties": {
    "id": "prop_meadowlands_square",
    "companyId": "cmp_nexus",
    "createdAt": "2025-01-22T10:00:00+02:00",
    "updatedAt": "2026-05-14T09:30:00+02:00",
    "name": "Meadowlands Square Shopping Centre",
    "code": "MSQ",
    "type": "shopping_centre",
    "address": {
      "line1": "1200 Modjadji Street",
      "suburb": "Meadowlands Zone 4",
      "city": "Soweto",
      "province": "Gauteng",
      "postalCode": "1852",
      "country": "South Africa"
    },
    "description": "Community shopping centre anchored by a franchise supermarket, with a pharmacy, fast-food and line shops serving Meadowlands and Dobsonville.",
    "status": "active",
    "grossLettableAreaSqm": 4850,
    "managerUserId": "usr_sipho_dlamini",
    "ownerUserId": "usr_pieter_botha",
    "accountingSystem": "MRI"
  },
  "statements": {
    "id": "stmt_msq_thrifty_2026_10",
    "companyId": "cmp_nexus",
    "createdAt": "2026-10-02T08:15:00+02:00",
    "updatedAt": "2026-10-02T09:40:00+02:00",
    "propertyId": "prop_meadowlands_square",
    "tenantId": "ten_thrifty_foods",
    "unitId": "unit_msq_a01",
    "leaseId": "lease_msq_l001",
    "file": {
      "fileName": "MSQ-2026-10-A01-ThriftyFoods.pdf",
      "storagePath": "statements/MSQ-2026-10-A01-ThriftyFoods.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 188420,
      "sha256": "-698f1118-5afbfc62-94ad3cf342d14ba-30ffe74c-49b5ac04-314de1ec78e0dfa1"
    },
    "sourceSystem": "MRI",
    "statementNumber": "MRI-MSQ-202610-0001",
    "statementDate": "2026-10-01",
    "periodStart": "2026-10-01",
    "periodEnd": "2026-10-31",
    "status": "verified",
    "uploadBatchId": "batch_msq_2026_10",
    "uploadedByUserId": "usr_sipho_dlamini",
    "uploadedAt": "2026-10-02T08:15:00+02:00",
    "extractionId": "ext_msq_thrifty_2026_10",
    "lineItems": [
      {
        "id": "stmt_msq_thrifty_2026_10_li01",
        "statementId": "stmt_msq_thrifty_2026_10",
        "date": "2026-10-01",
        "description": "Basic rental – October 2026",
        "category": "rental",
        "kind": "charge",
        "amount": 226632.96,
        "flagged": false
      },
      {
        "id": "stmt_msq_thrifty_2026_10_li02",
        "statementId": "stmt_msq_thrifty_2026_10",
        "date": "2026-10-01",
        "description": "Operating cost recovery",
        "category": "operating_costs",
        "kind": "charge",
        "amount": 48500,
        "flagged": false
      },
      {
        "id": "stmt_msq_thrifty_2026_10_li03",
        "statementId": "stmt_msq_thrifty_2026_10",
        "date": "2026-10-01",
        "description": "Rates and taxes recovery",
        "category": "rates_and_taxes",
        "kind": "charge",
        "amount": 21300,
        "flagged": false
      },
      {
        "id": "stmt_msq_thrifty_2026_10_li04",
        "statementId": "stmt_msq_thrifty_2026_10",
        "date": "2026-10-01",
        "description": "Marketing levy",
        "category": "marketing_levy",
        "kind": "charge",
        "amount": 4200,
        "flagged": false
      },
      {
        "id": "stmt_msq_thrifty_2026_10_li05",
        "statementId": "stmt_msq_thrifty_2026_10",
        "date": "2026-10-01",
        "description": "Electricity and water – September consumption",
        "category": "utilities",
        "kind": "charge",
        "amount": 18940.55,
        "flagged": false
      },
      {
        "id": "stmt_msq_thrifty_2026_10_li06",
        "statementId": "stmt_msq_thrifty_2026_10",
        "date": "2026-10-05",
        "description": "EFT payment received – THRIFTY FOODS MDL",
        "category": "payment",
        "kind": "payment",
        "amount": 319573.51,
        "flagged": false
      }
    ],
    "verifiedByUserId": "usr_sipho_dlamini",
    "verifiedAt": "2026-10-02T09:40:00+02:00",
    "deliveredCommunicationId": "com_stmt_thrifty_2026_10",
    "openingBalance": 0,
    "rentalCharged": 226632.96,
    "additionalCharges": 92940.55,
    "paymentsReceived": 319573.51,
    "closingBalance": 0,
    "totalDue": 0
  },
  "tenants": {
    "companyId": "cmp_nexus",
    "createdAt": "2025-01-24T09:00:00+02:00",
    "updatedAt": "2026-10-20T09:00:00+02:00",
    "id": "ten_thrifty_foods",
    "legalName": "Thrifty Foods Meadowlands (Pty) Ltd",
    "tradingName": "Thrifty Foods Supermarket",
    "businessType": "franchise",
    "registrationNumber": "2022/553120/07",
    "vatNumber": "4910288741",
    "primaryContact": {
      "fullName": "Bongani Sithole",
      "role": "Store Owner",
      "phone": "+27 82 334 1180",
      "email": "bongani@thriftyfoods-mdl.co.za"
    },
    "whatsappNumber": "+27823341180",
    "whatsappVerified": true,
    "whatsappOptedOut": false,
    "email": "accounts@thriftyfoods-mdl.co.za",
    "status": "active",
    "industry": "Grocery retail"
  },
  "units": {
    "companyId": "cmp_nexus",
    "createdAt": "2025-01-23T09:00:00+02:00",
    "updatedAt": "2026-11-01T08:00:00+02:00",
    "id": "unit_msq_a01",
    "propertyId": "prop_meadowlands_square",
    "unitNumber": "A01",
    "type": "anchor_retail",
    "floorAreaSqm": 2400,
    "floor": "Ground",
    "occupancyStatus": "occupied",
    "currentTenantId": "ten_thrifty_foods",
    "currentLeaseId": "lease_msq_l001",
    "description": "Anchor supermarket with loading dock and back-of-house cold rooms."
  }
}
