---
title: "SKN Superapp"
subtitle: "Integrated Enterprise HRIS & AI Face Recognition Attendance"
description: "Integrated Enterprise Human Resources Information System (HRIS) MVP developed for PT Surya Komponen Nusantara to manage ±1,200 employees with role-based access, GPS geofencing, AI face recognition attendance (FastAPI + InsightFace), and automated payroll generation."
tags: ["Laravel 12", "Livewire 3", "PostgreSQL", "FastAPI", "InsightFace", "Cloudflare R2", "Tailwind CSS", "Docker"]
year: "2026"
role: "Full-Stack Developer & AI Integrator"
repoUrl: "https://github.com/Xskyis/SKN-Superapp"
cover: "/projects/SKN.webp"
featured: true
order: 1
---

## Project Overview

**PT Surya Komponen Nusantara HRIS (SKN Superapp)** is an integrated Human Resources Information System (HRIS) MVP engineered for PT Surya Komponen Nusantara to manage workforce operations across ±1,200 employees, spanning multi-shift manufacturing staff and corporate office personnel.

The platform bridges enterprise resource planning with modern computer vision, integrating **GPS geofencing** and **real-time biometric face verification (Face Recognition AI)** to guarantee genuine attendance records while mitigating location spoofing and proxy check-ins.

---

### Core Architecture & Key Capabilities

- **Role-Based Workspaces**: Multi-tenant RBAC powered by Spatie Laravel Permission for 3 distinct organizational roles: *Pegawai (Staff)*, *HRD*, and *Keuangan (Finance)*, each with specialized dashboards visualized via Chart.js.
- **Biometric AI Microservice**: Stateless face recognition microservice built with FastAPI and InsightFace `buffalo_l` (ONNX runtime), containerized with Docker and deployed to Hugging Face Spaces for 512-dimensional facial embedding extraction and verification.
- **Integrated Payroll Pipeline**:
  `Job Class -> Base Salary -> (+ Approved Overtime, - Late Penalties / BPJS / Tax Deductions) -> Take-Home Pay (THP) -> Automated PDF Payslip Generation`
- **Cloud Object Storage**: Backed by Cloudflare R2 (S3-compatible API) for secure storage of facial biometric reference photos and official leave/overtime attachments.
- **Serverless PostgreSQL**: Relational data store hosted on Neon Serverless PostgreSQL with optimized indexing for high-frequency shift check-in transactions.
- **Repository**: [github.com/Xskyis/SKN-Superapp](https://github.com/Xskyis/SKN-Superapp)
