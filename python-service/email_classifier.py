# spec-analyzer/python-service/email_classifier.py
"""
Senior PM Email Classifier
Reads emails like a 30-year veteran masonry PM who:
- Catches scope creep and money opportunities
- Matches emails to projects
- Generates tasks when jobs are won
- Coaches the team on what to watch for
"""

import json
import os
from datetime import datetime
from typing import Optional

import httpx
from anthropic import Anthropic

# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════

# Mail4Subs - emails
MAIL4SUBS_URL = os.getenv("MAIL4SUBS_URL", "https://qiyonvhubpevqrrisqdl.supabase.co")
MAIL4SUBS_KEY = os.getenv("MAIL4SUBS_SERVICE_KEY") or os.getenv("MAIL4SUBS_KEY")

# PM4Subs - projects, proposals, spec analyses
PM4SUBS_URL = os.getenv("SUPABASE_URL", "https://muxjcyckyxviqjpmvcri.supabase.co")
PM4SUBS_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

# Anthropic
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# ═══════════════════════════════════════════════════════════════
# THE SENIOR PM PROMPT
# ═══════════════════════════════════════════════════════════════

SENIOR_PM_SYSTEM_PROMPT = """# ROLE
You are a senior masonry project manager with 30 years of subcontractor experience. You've seen every trick GCs and architects use to push costs down to subs. You know what's legitimately part of the job and what's extra work that deserves compensation.

You're taking over for a less experienced team. When you read their emails, you're not just organizing - you're PROTECTING THEIR MONEY and TEACHING THEM the business.

# YOUR EXPERTISE INCLUDES

## Scope Creep Detection
- Addenda that add work without acknowledgment
- "Clarifications" that are actually changes
- RFI responses that expand scope
- "Owner preferences" that weren't in bid documents
- Coordination requirements beyond spec

## Change Order Maximization
- What costs GCs typically reject vs. accept
- How to document and justify extra work
- Labor impacts (slower work, out-of-sequence, overtime)
- Material cost differences (upgrades, substitutions)
- Equipment and access costs they forget about
- Delay damages and acceleration costs

## Contract Protection
- What Division 01 typically requires vs. doesn't
- Submittal requirements and what's "extra"
- Testing and inspection responsibilities
- Warranty and callback limitations
- Payment terms and retainage release

## GC Negotiation
- How to push back professionally
- When to escalate vs. accommodate
- Documentation that wins disputes
- Relationships vs. getting paid (balance)

# THE TEAM (Milne Masonry / Powder River Masonry)
- Laurie: contracts, insurance, bonds, accounting, admin
- Ryan: estimating, submittals, vendor relationships, owner decisions
- Ben: field ops, site logistics, safety, crew management
- Mike/Cameron: field execution

# KNOWN VENDORS
- Brick: Adam (Acme Brick), Ryan Carnine (Interstate Brick)
- Block: [learn from emails]
- Mortar: [learn from emails]
- Scaffold: [learn from emails]

# CATEGORIES
Classify each email into ONE of these:
- bid_invite: Invitation to bid, new project opportunity
- bid_result: Award notice, bid results, you won/lost
- quote_request: Material or pricing requests from us to suppliers OR from GCs to us
- rfi: Requests for information
- change_order: CO, T&M, extra work discussions
- schedule: Schedule updates, delays, acceleration
- submittal: Submittal related correspondence
- urgent: Needs response TODAY - time sensitive
- action: Needs response, not urgent
- fyi: Informational, no response needed
- noise: Marketing, spam, newsletters, irrelevant

# WHEN YOU READ AN EMAIL, ASK YOURSELF
1. Is this actually in our scope, or are they adding work?
2. Is someone trying to get free work out of us?
3. What would I tell a junior PM to watch out for here?
4. Is there money on the table we might miss?
5. Does this match one of our active projects?
6. Is this a milestone (award, NTP, etc.) that triggers tasks?
7. Who on our team needs to handle this?"""


EMAIL_ANALYSIS_PROMPT = """# CONTEXT

## Active Projects & Proposals
{projects_json}

## Spec Analysis Data (if matched project has one)
{spec_analysis_json}

# EMAIL TO ANALYZE
Subject: {subject}
From: {from_name} <{from_email}>
Date: {received_at}

Body:
{body}

# RESPOND WITH JSON ONLY - NO MARKDOWN, NO EXPLANATION
Return ONLY a valid JSON object:
{{
  "category": "bid_invite|bid_result|quote_request|rfi|change_order|schedule|submittal|urgent|action|fyi|noise",
  "confidence": 0.0-1.0,

  "project_match": {{
    "matched_project_id": "uuid or null if no match",
    "matched_project_name": "name or null",
    "match_confidence": 0.0-1.0,
    "is_new_project": true,
    "suggested_name": "if new project detected, suggest a name"
  }},

  "sender": {{
    "role": "gc_pm|architect|supplier|sub|owner|unknown",
    "company": "extracted company name",
    "is_known_contact": false
  }},

  "scope_alert": {{
    "is_scope_creep": false,
    "explanation": "why this is or isn't scope creep - be specific",
    "co_opportunity": false,
    "co_justification": "if CO opportunity, exactly how to word it"
  }},

  "action": {{
    "needed": true,
    "urgency": "today|this_week|soon|none",
    "assigned_to": "Laurie|Ryan|Ben|none",
    "what_to_do": "specific action to take",
    "what_to_say": "suggested response language if needed"
  }},

  "milestone": {{
    "is_milestone": false,
    "type": "award|ntp|phase_complete|closeout|none",
    "trigger_tasks": false
  }},

  "vendor_intel": {{
    "is_vendor_email": false,
    "vendor_name": "name if identifiable",
    "material_type": "brick|block|mortar|scaffold|rebar|stone|other|none",
    "pricing_info": "any pricing mentioned"
  }},

  "money_alert": {{
    "money_mentioned": false,
    "type": "bid|quote|invoice|payment|change_order|none",
    "amount": "amount if mentioned",
    "status": "requested|submitted|approved|rejected|paid|overdue|none"
  }},

  "pm_notes": "1-2 sentence teaching moment. What would you tell a junior PM about this email? Be specific and practical."
}}"""


# ═══════════════════════════════════════════════════════════════
# DATA FETCHING
# ═══════════════════════════════════════════════════════════════


async def fetch_emails(
    limit: int = 50,
    only_unclassified: bool = False,
    category_filter: Optional[str] = None,
) -> list:
    """Fetch emails from Mail4Subs."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        url = f"{MAIL4SUBS_URL}/rest/v1/emails?select=*&order=received_at.desc&limit={limit}"

        if only_unclassified:
            url += "&category=is.null"
        elif category_filter:
            url += f"&category=eq.{category_filter}"

        response = await client.get(
            url,
            headers={
                "apikey": MAIL4SUBS_KEY,
                "Authorization": f"Bearer {MAIL4SUBS_KEY}",
            },
        )

        if response.status_code != 200:
            print(f"[FETCH_EMAILS] Error: {response.status_code} - {response.text}")
            return []

        return response.json()


async def fetch_projects() -> list:
    """Fetch active projects from PM4Subs."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{PM4SUBS_URL}/rest/v1/jobs?select=id,name,status,company_id&status=in.(active,bidding,pending)",
            headers={"apikey": PM4SUBS_KEY, "Authorization": f"Bearer {PM4SUBS_KEY}"},
        )

        if response.status_code != 200:
            print(f"[FETCH_PROJECTS] Error: {response.status_code}")
            return []

        return response.json()


async def fetch_proposals() -> list:
    """Fetch proposals from PM4Subs."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{PM4SUBS_URL}/rest/v1/proposals?select=id,name,gc_name,status,created_at&status=in.(draft,submitted,review,sent)",
            headers={"apikey": PM4SUBS_KEY, "Authorization": f"Bearer {PM4SUBS_KEY}"},
        )

        if response.status_code != 200:
            print(f"[FETCH_PROPOSALS] Error: {response.status_code}")
            return []

        return response.json()


async def fetch_spec_analysis(job_id: str) -> Optional[dict]:
    """Fetch spec analysis for a job if it exists."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{PM4SUBS_URL}/rest/v1/spec_analyses?job_id=eq.{job_id}&select=division_code,analysis_type,result&limit=5",
            headers={"apikey": PM4SUBS_KEY, "Authorization": f"Bearer {PM4SUBS_KEY}"},
        )

        if response.status_code == 200:
            data = response.json()
            if data:
                return data

        return None


async def update_email_classification(email_id: str, classification: dict) -> bool:
    """Update email with classification results in Mail4Subs."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Build update data - only include fields that exist in the emails table
        update_data = {
            "category": classification.get("category"),
            "classified_at": datetime.utcnow().isoformat(),
            "classified_by": "sonnet-senior-pm",
        }

        # Store rich data as JSON in a metadata field if it exists
        # Otherwise just update category
        metadata = {
            "confidence": classification.get("confidence"),
            "project_match": classification.get("project_match"),
            "sender": classification.get("sender"),
            "scope_alert": classification.get("scope_alert"),
            "action": classification.get("action"),
            "milestone": classification.get("milestone"),
            "vendor_intel": classification.get("vendor_intel"),
            "money_alert": classification.get("money_alert"),
            "pm_notes": classification.get("pm_notes"),
        }

        # Try to update with metadata field
        update_data["classification_metadata"] = json.dumps(metadata)

        response = await client.patch(
            f"{MAIL4SUBS_URL}/rest/v1/emails?id=eq.{email_id}",
            headers={
                "apikey": MAIL4SUBS_KEY,
                "Authorization": f"Bearer {MAIL4SUBS_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=update_data,
        )

        # If metadata field doesn't exist, just update category
        if response.status_code == 400:
            update_data = {"category": classification.get("category")}
            response = await client.patch(
                f"{MAIL4SUBS_URL}/rest/v1/emails?id=eq.{email_id}",
                headers={
                    "apikey": MAIL4SUBS_KEY,
                    "Authorization": f"Bearer {MAIL4SUBS_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=update_data,
            )

        success = response.status_code in [200, 204]
        if not success:
            print(f"[UPDATE_EMAIL] Error {response.status_code}: {response.text}")

        return success


# ═══════════════════════════════════════════════════════════════
# CLASSIFICATION ENGINE
# ═══════════════════════════════════════════════════════════════


async def classify_email(email: dict, projects: list, proposals: list) -> dict:
    """Classify a single email using Sonnet as Senior PM."""

    if not ANTHROPIC_API_KEY:
        print("[CLASSIFY] ERROR: No ANTHROPIC_API_KEY")
        return {"category": "fyi", "confidence": 0, "pm_notes": "No API key configured"}

    client = Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build context - combine projects and proposals
    all_projects = []
    for p in projects:
        all_projects.append(
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "status": p.get("status"),
                "type": "project",
            }
        )
    for p in proposals:
        all_projects.append(
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "gc": p.get("gc_name"),
                "status": p.get("status"),
                "type": "proposal",
            }
        )

    projects_json = (
        json.dumps(all_projects, indent=2)
        if all_projects
        else "No active projects or proposals."
    )

    # For now, no spec analysis context (we'd need to match first)
    spec_analysis_json = "No spec analysis linked to this email yet."

    # Build the prompt
    body_text = email.get("body") or email.get("snippet") or "No content"
    # Truncate body to avoid token limits
    if len(body_text) > 3000:
        body_text = body_text[:3000] + "\n\n[... truncated ...]"

    prompt = EMAIL_ANALYSIS_PROMPT.format(
        projects_json=projects_json,
        spec_analysis_json=spec_analysis_json,
        subject=email.get("subject", "No Subject"),
        from_name=email.get("from_name", "Unknown"),
        from_email=email.get("from_email", "unknown@unknown.com"),
        received_at=email.get("received_at", "Unknown date"),
        body=body_text,
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            system=SENIOR_PM_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = response.content[0].text.strip()

        # Clean up response - remove markdown code blocks if present
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()

        result = json.loads(response_text)
        return result

    except json.JSONDecodeError as e:
        print(f"[CLASSIFY] JSON parse error: {e}")
        print(
            f"[CLASSIFY] Raw response: {response_text[:500] if 'response_text' in dir() else 'No response'}"
        )
        return {
            "category": "fyi",
            "confidence": 0.3,
            "pm_notes": "Classification failed to parse - needs manual review",
            "error": str(e),
        }
    except Exception as e:
        print(f"[CLASSIFY] Error: {e}")
        return {
            "category": "fyi",
            "confidence": 0.3,
            "pm_notes": f"Classification error: {str(e)}",
            "error": str(e),
        }


# ═══════════════════════════════════════════════════════════════
# MAIN RECLASSIFY FUNCTION
# ═══════════════════════════════════════════════════════════════


async def reclassify_emails(
    limit: int = 50,
    only_unclassified: bool = False,
    category_filter: Optional[str] = None,
) -> dict:
    """
    Main function to reclassify emails using Senior PM brain.
    Called by the /reclassify endpoint in main.py.

    Args:
        limit: Max number of emails to process
        only_unclassified: Only process emails without a category
        category_filter: Only process emails with this category

    Returns:
        dict with status, processed count, results breakdown, and changes list
    """
    print(
        f"[RECLASSIFY] Starting: limit={limit}, only_unclassified={only_unclassified}, filter={category_filter}"
    )

    # Validate config
    if not MAIL4SUBS_KEY:
        return {
            "status": "error",
            "processed": 0,
            "results": {},
            "changes": [],
            "error": "MAIL4SUBS_KEY not configured",
        }
    if not ANTHROPIC_API_KEY:
        return {
            "status": "error",
            "processed": 0,
            "results": {},
            "changes": [],
            "error": "ANTHROPIC_API_KEY not configured",
        }

    # Fetch all data we need
    print("[RECLASSIFY] Fetching emails...")
    emails = await fetch_emails(limit, only_unclassified, category_filter)

    print("[RECLASSIFY] Fetching projects...")
    projects = await fetch_projects()

    print("[RECLASSIFY] Fetching proposals...")
    proposals = await fetch_proposals()

    print(
        f"[RECLASSIFY] Found {len(emails)} emails, {len(projects)} projects, {len(proposals)} proposals"
    )

    if not emails:
        return {
            "status": "complete",
            "processed": 0,
            "results": {"message": "No emails to process"},
            "changes": [],
        }

    # Track results
    results = {
        "bid_invite": 0,
        "bid_result": 0,
        "quote_request": 0,
        "rfi": 0,
        "change_order": 0,
        "schedule": 0,
        "submittal": 0,
        "urgent": 0,
        "action": 0,
        "fyi": 0,
        "noise": 0,
        "error": 0,
    }
    changes = []
    scope_alerts = []
    money_alerts = []

    # Process each email
    for i, email in enumerate(emails):
        subject_preview = (email.get("subject") or "No subject")[:60]
        print(f"[RECLASSIFY] [{i + 1}/{len(emails)}] {subject_preview}")

        old_category = email.get("category")

        # Classify with Senior PM
        classification = await classify_email(email, projects, proposals)
        new_category = classification.get("category", "fyi")

        # Track category counts
        if new_category in results:
            results[new_category] += 1
        else:
            results["error"] += 1

        # Track changes
        if old_category != new_category:
            change_record = {
                "email_id": email["id"],
                "subject": email.get("subject", "")[:100],
                "from": email.get("from_email", ""),
                "old_category": old_category,
                "new_category": new_category,
                "confidence": classification.get("confidence", 0),
                "pm_notes": classification.get("pm_notes", ""),
            }
            changes.append(change_record)

        # Track scope creep alerts
        scope_alert = classification.get("scope_alert", {})
        if scope_alert.get("is_scope_creep") or scope_alert.get("co_opportunity"):
            scope_alerts.append(
                {
                    "email_id": email["id"],
                    "subject": email.get("subject", "")[:100],
                    "explanation": scope_alert.get("explanation", ""),
                    "co_justification": scope_alert.get("co_justification", ""),
                }
            )

        # Track money alerts
        money_alert = classification.get("money_alert", {})
        if money_alert.get("money_mentioned"):
            money_alerts.append(
                {
                    "email_id": email["id"],
                    "subject": email.get("subject", "")[:100],
                    "type": money_alert.get("type"),
                    "amount": money_alert.get("amount"),
                    "status": money_alert.get("status"),
                }
            )

        # Update email in database
        update_success = await update_email_classification(email["id"], classification)
        if not update_success:
            print(f"[RECLASSIFY] Failed to update email {email['id']}")

    print(
        f"[RECLASSIFY] Complete. Processed {len(emails)}, {len(changes)} category changes"
    )
    print(
        f"[RECLASSIFY] Found {len(scope_alerts)} scope alerts, {len(money_alerts)} money alerts"
    )

    return {
        "status": "complete",
        "processed": len(emails),
        "results": results,
        "changes": changes,
        "scope_alerts": scope_alerts,
        "money_alerts": money_alerts,
    }
