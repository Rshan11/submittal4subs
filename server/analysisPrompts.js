/**
 * Ultra-specific prompts for spec analysis
 */

/**
 * Security Requirements Analysis
 * Always run this on Division 00 & 01
 */
function getSecurityPrompt(div00and01Text) {
  return `You are analyzing construction specifications for security and access control requirements.

SPECIFICATION TEXT (Division 00 & 01):
${div00and01Text}

YOUR TASK: Extract EVERY security, background check, and access requirement. Be extremely thorough.

OUTPUT FORMAT (use exact headers):

## SECURITY REQUIREMENTS

### Background Checks
- Required: [YES/NO - if yes, provide details]
- Type: [FBI, state, local, credit check, etc.]
- Processing Time: [exact timeframe from spec]
- Cost: [if specified, who pays]
- Frequency: [one-time, annual renewal, etc.]
- Restrictions: [any limitations while pending]

### Security Clearances
- Required: [YES/NO]
- Level: [Secret, Top Secret, HSPD-12, PIV, site-specific, etc.]
- Processing Time: [exact timeframe]
- Interim Work Allowed: [can work while clearance is pending?]
- Validity Period: [how long clearance lasts]

### Site Access & Badging
- Badge Required: [YES/NO]
- Badge Type: [temporary, permanent, escort, etc.]
- How to Obtain: [process description]
- Escort Requirements: [if unbadged workers need escorts]
- Visitor Protocols: [process for visitors]
- Hours: [allowed work hours]

### Drug Testing
- Pre-Employment: [YES/NO]
- Random Testing: [YES/NO, frequency if specified]
- Post-Incident: [YES/NO]
- Who Administers: [company, owner, third party]
- Cost: [if specified]

### Special Facility Requirements
- Nuclear Facility: [YES/NO - note any special requirements]
- Airport Security: [YES/NO - TSA requirements]
- Government Facility: [YES/NO - specific rules]
- Military Base: [YES/NO - DoD requirements]
- Healthcare: [HIPAA or patient safety requirements]

### Documentation Required
List every document workers must provide:
- [e.g., Photo ID, passport, birth certificate, etc.]

### Restricted Areas
- Are there restricted zones? [YES/NO]
- What areas? [list if specified]
- Access requirements: [how to get access]

### Cost Impact to Contractor
Estimate per-worker costs if specified:
- Background checks: $_____ per worker
- Drug tests: $_____ per worker  
- Badges: $_____ per worker
- Training: $_____ per worker
- Total estimated cost per worker: $_____

### Processing Timeline
CRITICAL: How long before workers can start?
- Background check: ___ weeks
- Security clearance: ___ weeks
- Badging: ___ days
- Total lead time: ___ weeks

### Red Flags 🚩
Identify high-cost or high-risk requirements:
[List anything unusual, expensive, or that could delay mobilization]

---

SEARCH KEYWORDS TO LOOK FOR:
background, clearance, security, badge, FBI, drug test, screening, access, escort, HSPD, PIV, credential, classified, confidential, restricted, authorized personnel, identification, ID card

CRITICAL INSTRUCTIONS:
- If you find a requirement, extract the EXACT wording from the spec
- Include section numbers where found (e.g., "Section 01 35 00")
- If something is NOT specified, write "NOT SPECIFIED" 
- If this seems like a facility that SHOULD have security requirements but none are found, note: "⚠️ WARNING: No security requirements found - unusual for [nuclear/airport/government] facility. Verify with owner."
- DO NOT make assumptions - only report what's explicitly stated

If absolutely no security requirements are found, state:
"NO SECURITY OR ACCESS REQUIREMENTS SPECIFIED IN DIVISIONS 00 & 01"`;
}

/**
 * Masonry-Specific Analysis
 */
function getMasonryPrompt(div04Text) {
  return `You are a masonry estimator analyzing Division 04 specifications to prepare a bid. Extract EVERY specification detail with extreme precision.

SPECIFICATION TEXT (Division 04 - Masonry):
${div04Text}

YOUR TASK: Extract every material, standard, dimension, temperature, and requirement. Be so detailed that a supplier could quote from this analysis.

OUTPUT FORMAT (use exact headers):

## MASONRY SPECIFICATIONS

### Masonry Units

For EACH type of masonry unit specified, extract:

**[Unit Type - e.g., "Concrete Masonry Units", "Clay Brick", "Thin Brick"]:**
- Standard: [ASTM C90, C55, C216, C1088, etc. - list ALL]
- Grade: [N, S, MW, SW, Exterior, Interior, etc.]
- Type: [I, II, FBS, FBX, etc.]
- Size: [exact nominal dimensions, e.g., "8x8x16 nominal"]
- Weight: [lightweight, medium weight, normal weight - with values if given]
- Strength: [minimum compressive strength, PSI]
- Absorption: [maximum water absorption percentage]
- Color: [exact color specification or "Architect to select"]
- Texture: [smooth, split-face, ground face, etc.]
- Finish: [glazed, unglazed, scored, etc.]
- Core Type: [solid, hollow, % solid]
- Manufacturer: [if specified, or "Subject to approval"]
- Product Name: [if specific product named]

### Mortar

**Type(s) Specified:**
- Mortar Type: [M, S, N, O, K]
- Standard: [ASTM C270, C1714, etc.]
- Mix: [proportion or property specification]
- Color: [if specified - exact color name/number]
- Additives: [any required additives]
- **Restrictions**: [list any "SHALL NOT" or "NOT PERMITTED" items]
  Example: "Cold weather additives NOT PERMITTED"

### Grout

- Type: [fine, coarse]
- Standard: [ASTM C476, etc.]
- Strength: [minimum PSI]
- Placement: [method specifications]

### Mortar Joints

- Bed Joint Thickness: [exact dimension, e.g., "3/8 inch"]
- Head Joint Thickness: [exact dimension]
- Joint Finish: [concave, flush, raked, etc.]
- Tooling: [requirements for tooled joints]
- Tolerance: [if specified]

### Reinforcement & Anchors

**Joint Reinforcement:**
- Type: [ladder, truss]
- Wire Size: [gauge]
- Standard: [ASTM A951, etc.]
- Spacing: [vertical spacing]
- Splices: [lap requirements]

**Wall Ties:**
- Type: [adjustable, rigid, corrugated, etc.]
- Material: [galvanized, stainless, etc.]
- Standard: [ASTM A153, A1008, etc.]
- Spacing: [horizontal and vertical]
- Who Provides: [masonry contractor or other]

**Anchors & Fasteners:**
[List all specified anchors with standards]

### Accessories

**Flashing:**
- Material: [stainless steel, copper, rubberized asphalt, etc.]
- Standard: [ASTM A240, B370, etc.]
- Type/Grade: [e.g., "Type 304", "16 oz copper"]
- Thickness: [e.g., "0.016 inch minimum"]
- Locations: [where required]
- Termination: [end dam requirements]

**Weep Holes:**
- Type: [rope, tube, open head joint]
- Size: [dimensions]
- Spacing: [e.g., "24 inches on center"]
- Location: [above all flashing]

**Control Joints:**
- Spacing: [maximum spacing]
- Type: [sealant, preformed gasket, etc.]
- Location criteria: [corners, openings, etc.]

**Weather Barrier:**
- Type: [building paper, fluid-applied, etc.]
- Standard: [ASTM E2556, D226, etc.]
- Weight: [e.g., "#15 felt"]

### Installation Requirements

**General:**
- Workmanship Standard: [TMS 602, ACI 530.1, etc.]
- Bond Pattern: [running, stack, flemish, etc.]
- Coursing: [if specified]
- Corner Construction: [requirements]
- Parging: [if required, where]

**Weather Limitations:**

CRITICAL - Extract EXACT numbers:

**Cold Weather:**
- Minimum Temperature: [exact °F or °C]
- Additional Requirements: [protection, heating, enclosures]
- Curing Requirements: [specific procedures]
- Duration: [how long restrictions apply]

**Hot Weather:**
- Maximum Temperature: [exact °F or °C]
- Wind Speed Limit: [if specified, exact mph]
  Example: "Stop work if temperature exceeds 90°F AND wind exceeds 8 mph"
- Protection: [shade, wetting requirements]
- Curing: [fog spray, wet covering, duration]

**Rain:**
- Cover requirements: [when and how]
- Work stoppage: [when required]

**General Weather:**
- Temperature range for work: [minimum to maximum]
- Wind restrictions: [if any]

### Cleaning

- Method: [water, chemical, etc.]
- Products: [approved cleaners or "subject to approval"]
- Timing: [when to clean]
- Test Panel: [required? size? location?]
- Prohibited Methods: [sandblasting, acids, etc.]
- Protection: [adjacent surfaces, windows, etc.]

### Quality Control & Testing

**Testing Required:**

For EACH test, extract:
- Test Name: [e.g., "Brick absorption testing"]
- Standard: [ASTM C67, C140, etc.]
- Frequency: [e.g., "one test per 5,000 units"]
- When: [before delivery, during construction, etc.]
- Who Performs: [independent lab, manufacturer, contractor]
- Acceptance Criteria: [pass/fail criteria]
- Cost: [if specified, who pays]
- Report Requirements: [copies, timing]

**Mockups/Sample Panels:**
- Required: [YES/NO]
- Size: [dimensions]
- Location: [where built]
- Approval: [who approves]
- Represents: [what it demonstrates]
- Becomes: [part of work, removed, etc.]

**Inspection:**
- Frequency: [continuous, periodic, special]
- Who Inspects: [architect, testing agency, owner]
- Access: [scaffolding requirements]

### Qualifications

**Installer:**
- Minimum Experience: [years on similar projects]
- Certifications: [if required]
- References: [number required]
- Supervision: [journeyman required?]

**Manufacturer:**
- Requirements: [experience, capacity, etc.]

**Testing Laboratory:**
- Accreditation: [required certifications]

### Submittals

For EACH submittal item:

**[Submittal Name]:**
- Type: [product data, shop drawings, samples, test reports, certifications]
- Timing: [before ordering, before installation, etc.]
- Contents Required:
  - [List every document/sample needed]
- Samples: [number, size, return requirements]
- Approval Authority: [architect, engineer, owner]

Example:
**Thin Brick Samples:**
- Type: Samples
- Timing: Before ordering materials
- Contents Required:
  - 3 samples of each color (6"x6" minimum)
  - Manufacturer's product data
  - ASTM C1088 test reports
  - Certification of compliance
- Approval Authority: Architect

### Warranty

- Duration: [years]
- Coverage: [what's covered]
- Exclusions: [what's not covered]

### Standards Referenced

List EVERY standard mentioned:
- ASTM C90 - Concrete Masonry Units
- ASTM C270 - Mortar
- TMS 602 - Specification for Masonry Structures
[etc. - list ALL]

### Red Flags 🚩

Identify high-cost, high-risk, or unusual requirements:
- 🚩 Independent testing required (cost: $_____)
- 🚩 5-year installer experience minimum (limits subcontractor options)
- 🚩 Cold weather additives NOT PERMITTED (restricts schedule)
- 🚩 [etc.]

### Missing Information ⚠️

List critical information NOT specified:
- ⚠️ Brick color not specified
- ⚠️ No quantities provided
- ⚠️ Mortar color not specified
[etc.]

### Materials Pricing List

Organize for supplier quotes:
- Thin brick: ASTM C1088 Grade Exterior, [color TBD], QTY: TBD SF
- Type M mortar: ASTM C270, [color TBD], QTY: TBD CF
- Stainless steel flashing: ASTM A240 Type 304, 0.016" min, QTY: TBD LF
[etc.]

---

CRITICAL INSTRUCTIONS:
- Extract EXACT wording for temperatures, dimensions, standards
- Include section numbers (e.g., "Section 04 05 13")
- Note "NOT SPECIFIED" for missing information
- Flag restrictions with "NOT PERMITTED" or "SHALL NOT"
- Be detailed enough that someone could bid from this analysis
- If you see a number, extract it with units (e.g., "40°F" not "cold weather")

If Division 04 was not found or text appears to be from wrong section:
"⚠️ WARNING: Could not locate Division 04 - Masonry section. Analysis may be incomplete or incorrect."`;
}

/**
 * Contract Requirements Analysis
 */
function getContractPrompt(div00and01Text) {
  return `You are analyzing Division 00 & 01 for contract requirements that affect bidding and cost.

SPECIFICATION TEXT (Division 00 & 01):
${div00and01Text}

YOUR TASK: Extract ALL requirements that impact contractor costs, schedule, or risk.

OUTPUT FORMAT:

## CONTRACT REQUIREMENTS

### Insurance

**General Liability:**
- Per Occurrence: $______
- General Aggregate: $______
- Products/Completed Operations: $______

**Automobile Liability:**
- Combined Single Limit: $______

**Workers' Compensation:**
- Statutory Limits: [YES/NO]
- Employer's Liability: $______

**Umbrella/Excess:**
- Amount: $______

**Builder's Risk:**
- Required: [YES/NO]
- Who Provides: [owner/contractor]
- Amount: $______

**Professional Liability** (if applicable):
- Amount: $______

**Additional Insureds:**
- Owner: [YES/NO]
- Architect: [YES/NO]
- General Contractor: [YES/NO]
- Others: [list]

**Waiver of Subrogation:**
- Required: [YES/NO]
- Applies to: [list parties]

### Bonding

**Bid Bond:**
- Required: [YES/NO]
- Amount: [% or $]

**Performance Bond:**
- Required: [YES/NO]
- Amount: [% of contract]

**Payment Bond:**
- Required: [YES/NO]
- Amount: [% of contract]

**Bonding Company Requirements:**
- A.M. Best Rating: [minimum rating]
- Treasury List: [must be on list?]

### Payment Terms

**Progress Payments:**
- Frequency: [monthly, based on % complete, milestone-based]
- Due Date: [day of month or days after application]
- Application Deadline: [when to submit]

**Retainage:**
- Percentage: [%]
- When Reduced: [at substantial completion, 50% complete, etc.]
- Final Retainage: [% held until final completion]

**Payment Period:**
- Owner Payment to GC: [days after approval]
- GC Payment to Subs: [days after GC receives payment]
- Total Time: [worst case days from application to payment]

**Lien Waivers:**
- Conditional: [required when]
- Unconditional: [required when]
- Who Required: [subs, suppliers, sub-subs]

### Schedule

**Key Dates:**
- Bid Due: [date/time]
- Pre-Bid Meeting: [date/time/location]
- Site Visit: [date/time or "by appointment"]
- Notice to Proceed: [expected date or "TBD"]
- Start Construction: [date or "within X days of NTP"]
- Substantial Completion: [date or duration from start]
- Final Completion: [date or "X days after substantial"]
- Total Duration: [calendar days or months]

**Liquidated Damages:**
- Amount: $______ per day
- Applies to: [substantial completion, final completion, milestones]
- Exceptions: [weather delays, etc.]

**Milestones:**
[List any interim completion dates with associated LD amounts]

**Working Hours:**
- Normal Hours: [e.g., "7 AM to 5 PM Monday-Friday"]
- Weekend Work: [allowed with approval, not allowed, etc.]
- Night Work: [requirements]
- Noise Restrictions: [if any]

### Prevailing Wage

**Required:** [YES/NO]
- Jurisdiction: [federal/state/county]
- Classifications: [list if specified]
- Certified Payroll: [frequency of submittal]
- Penalties: [for non-compliance]
- Apprentice Ratios: [if specified]

### Permits & Fees

**Contractor Responsibilities:**
[List each permit/fee contractor must obtain/pay]

**Owner Responsibilities:**
[List what owner handles]

### Submittals

**General Requirements:**
- Review Time: [days for architect review]
- Number of Copies: [if specified]
- Format: [PDF, hard copy, specific system]
- Resubmittal Time: [days allowed for resubmittal]
- Approval Required Before: [ordering, fabrication, installation]

### Warranty

**Standard Warranty:**
- Duration: [1 year from substantial completion, etc.]
- Starts: [substantial or final completion]

**Extended Warranties:**
[List any systems requiring longer warranties]

### Special Requirements

**Buy America/Buy American:**
- Required: [YES/NO]

**Davis-Bacon:**
- Required: [YES/NO]

**Prevailing Wage:**
- Required: [YES/NO]

**MBE/WBE/DBE Goals:**
- Percentage: [%]

### Red Flags 🚩

High-risk or high-cost contract terms:
[List anything unusual, onerous, or expensive]

---

CRITICAL INSTRUCTIONS:
- Extract EXACT dollar amounts, percentages, timeframes
- Include section references
- Note "NOT SPECIFIED" for missing information
- Flag unusual requirements as red flags
- Be precise with dates and numbers`;
}

/**
 * Get appropriate prompt based on trade
 */
function getTradePrompt(trade, divisionText) {
  const prompts = {
    'masonry': getMasonryPrompt(divisionText),
    'concrete': getConcretePrompt(divisionText),
    'steel': getSteelPrompt(divisionText),
  };
  
  return prompts[trade] || getGenericTradePrompt(trade, divisionText);
}

function getGenericTradePrompt(trade, divisionText) {
  return `You are analyzing specifications for ${trade} work.

SPECIFICATION TEXT:
${divisionText}

Extract all requirements including:
- Materials and standards
- Installation requirements  
- Testing and quality control
- Weather limitations
- Submittals
- Qualifications
- Warranties

Be extremely specific with standards, dimensions, temperatures, and requirements.`;
}

// Stub functions - implement similar to masonry
function getConcretePrompt(text) {
  return `[Similar ultra-detailed prompt for concrete - to be implemented]`;
}

function getSteelPrompt(text) {
  return `[Similar ultra-detailed prompt for steel - to be implemented]`;
}

export {
  getSecurityPrompt,
  getContractPrompt,
  getTradePrompt,
  getMasonryPrompt
};
