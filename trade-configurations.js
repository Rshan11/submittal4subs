// TRADE-SPECIFIC CONFIGURATIONS FOR PM4SUBS MULTI-TRADE SYSTEM
// ============================================================================
// Created: November 2024
// Purpose: Centralized trade configurations for 5-trade beta launch

// Trade to Division Mapping (CSI MasterFormat)
const TRADE_DIVISION_MAP = {
  'masonry': '4',
  'concrete': '3',
  'drywall': '9',
  'electrical': '26',
  'hvac': '23'
};

// Expected Coordination Divisions (What each trade needs to coordinate with)
const COORDINATION_DIVISIONS = {
  'masonry': {
    primary: ['3', '5', '7'], // Concrete, metals, thermal
    secondary: ['6', '8'], // Wood, openings
    keywords: ['concrete', 'steel', 'anchor', 'flashing', 'insulation', 'waterproof', 'embed', 'lintel', 'shelf angle']
  },
  'concrete': {
    primary: ['2', '4', '5', '7'], // Demo, masonry, steel, waterproofing
    secondary: ['31', '32'], // Earthwork, site
    keywords: ['formwork', 'reinforcing', 'steel', 'waterproofing', 'joint', 'excavation', 'rebar', 'embed', 'anchor bolt']
  },
  'drywall': {
    primary: ['5', '6', '9', '22', '23', '26'], // Metals, wood, finishes, MEP
    secondary: ['7', '8'], // Insulation, openings
    keywords: ['framing', 'insulation', 'electrical', 'plumbing', 'hvac', 'ceiling', 'acoustical', 'stud', 'backing']
  },
  'electrical': {
    primary: ['5', '26', '27', '28'], // Metals, electrical, communications, security
    secondary: ['22', '23'], // Plumbing, HVAC
    keywords: ['conduit', 'panel', 'fixture', 'device', 'wire', 'cable', 'grounding', 'lighting', 'receptacle', 'switch']
  },
  'hvac': {
    primary: ['5', '22', '23', '26'], // Metals, plumbing, HVAC, electrical
    secondary: ['7', '21'], // Insulation, fire suppression
    keywords: ['ductwork', 'piping', 'equipment', 'diffuser', 'grille', 'controls', 'insulation', 'vav', 'damper']
  }
};

// Trade-Specific Analysis Prompts for analyze-trade Edge Function
const TRADE_PROMPTS = {
  masonry: `You are creating a pricing checklist for a MASONRY contractor.

Focus on:
- CMU sizes, types, and grades (standard vs. high-strength)
- Brick specifications (facing brick, building brick, veneer)
- Mortar types and colors (Type N, S, M)
- Grout specifications (fine vs. coarse)
- Joint reinforcement and anchors
- Flashing and weep requirements
- Control and expansion joints
- Special finishes or patterns
- Cleaning and sealing requirements
- Testing requirements (ASTM standards)

Use color coding:
🟢 = Fully specified (size, grade, brand, standard) - ready to price
🟡 = Partially specified (some vagueness) - note assumptions needed
🔴 = Missing critical info - RFI required before pricing

Format as actionable checklist with quantities when possible.`,

  concrete: `You are creating a pricing checklist for a CONCRETE contractor.

Focus on:
- Concrete mix designs and strengths (3000 psi, 4000 psi, etc.)
- Formwork requirements (type, reuse, finishes)
- Reinforcing steel (#4, #5, spacing, epoxy coated)
- Pour sequence and construction joints
- Finishing requirements (troweled, broom finish, polished)
- Curing methods and duration
- Special admixtures (accelerators, retarders, waterproofing)
- Tolerances and flatness requirements
- Testing and sampling (cylinder breaks, slump tests)
- Vapor barriers and moisture protection

Use color coding:
🟢 = Fully specified (mix design, finish, curing) - ready to price
🟡 = Partially specified (some vagueness) - note assumptions needed
🔴 = Missing critical info - RFI required before pricing

Format as actionable checklist with cubic yards/square feet when possible.`,

  drywall: `You are creating a pricing checklist for a DRYWALL contractor.

Focus on:
- Gypsum board type and thickness (5/8" Type X, moisture-resistant)
- Fire rating requirements (1-hour, 2-hour assemblies)
- Framing type and spacing (metal studs, wood studs)
- Finish levels (Level 3, 4, or 5 per ASTM C840)
- Acoustical requirements (STC ratings)
- Ceiling types (drywall, acoustical tile, exposed)
- Joint treatment and texture specifications
- Specialty boards (abuse-resistant, mold-resistant)
- Access panels and blocking requirements
- Coordination with MEP penetrations

Use color coding:
🟢 = Fully specified (type, finish level, fire rating) - ready to price
🟡 = Partially specified (some vagueness) - note assumptions needed
🔴 = Missing critical info - RFI required before pricing

Format as actionable checklist with square footage when possible.`,

  electrical: `You are creating a pricing checklist for an ELECTRICAL contractor.

Focus on:
- Voltage and phase (120V, 208V, 480V, single/three phase)
- Panel boards and distribution (main, sub-panels, load centers)
- Conduit types and sizes (EMT, rigid, PVC)
- Wire and cable specifications (THHN, MC cable, sizes)
- Fixtures and devices (receptacles, switches, lighting fixtures)
- Grounding and bonding requirements
- Special systems (fire alarm, emergency power, data/comm)
- Testing and commissioning requirements
- Motor connections and controls
- Integration with building automation

Use color coding:
🟢 = Fully specified (voltage, wire size, fixture type) - ready to price
🟡 = Partially specified (some vagueness) - note assumptions needed
🔴 = Missing critical info - RFI required before pricing

Format as actionable checklist with quantities and circuit counts when possible.`,

  hvac: `You are creating a pricing checklist for an HVAC contractor.

Focus on:
- Equipment specifications (tonnage, efficiency ratings, brands)
- Ductwork materials and gauges (galvanized, flexible, insulation)
- Piping materials (copper, steel, PVC for drainage)
- Controls and thermostats (DDC, programmable, zones)
- Diffusers and grilles (types, sizes, finishes)
- Refrigerant lines and insulation
- Vibration isolation and noise control
- Testing, adjusting, and balancing (TAB) requirements
- Equipment connections (electrical, condensate, gas)
- Filtration and air quality requirements

Use color coding:
🟢 = Fully specified (equipment model, duct size, controls) - ready to price
🟡 = Partially specified (some vagueness) - note assumptions needed
🔴 = Missing critical info - RFI required before pricing

Format as actionable checklist with equipment counts and CFM when possible.`
};

// Coordination Analysis Prompts for analyze-coordination Edge Function
const COORDINATION_PROMPTS = {
  masonry: `Analyze coordination requirements for a MASONRY contractor.

The masonry contractor needs to coordinate with:
- CONCRETE: Foundation/slab preparation, anchor embedment, curing time before masonry starts
- METALS: Steel lintels, shelf angles, structural steel interface, embed plates
- THERMAL & MOISTURE: Flashing installation, insulation thickness for anchor sizing, weep holes
- OPENINGS: Door/window frames, rough opening sizes, anchorage methods

For each related division, identify:
✓ Specific products/materials that affect masonry installation
✓ Dimensional requirements and tolerances critical to masonry
✓ Installation sequencing and timing dependencies
✓ Interface details and connection methods
✓ Potential conflicts or risks

Provide actionable coordination items with risk indicators:
🔴 = Critical coordination required before bid
🟡 = Important coordination during construction
🟢 = Minor coordination item`,

  concrete: `Analyze coordination requirements for a CONCRETE contractor.

The concrete contractor needs to coordinate with:
- DEMOLITION: Existing conditions, substrate preparation, removal limits
- MASONRY: Dovetail slots, anchor bolts, interface details, timing
- METALS: Embed plates, anchor bolts, structural steel connections, welded attachments
- WATERPROOFING: Below-grade protection, construction joints, cold joints

For each related division, identify:
✓ Embedments and blockouts required in concrete
✓ Surface preparation and finish requirements affecting concrete
✓ Structural interface details and tolerances
✓ Sequencing and protection requirements
✓ Potential conflicts or risks

Provide actionable coordination items with risk indicators:
🔴 = Critical coordination required before bid
🟡 = Important coordination during construction
🟢 = Minor coordination item`,

  drywall: `Analyze coordination requirements for a DRYWALL contractor.

The drywall contractor needs to coordinate with:
- FRAMING: Stud spacing, fire-rated assemblies, backing requirements
- INSULATION: Type and thickness, vapor barriers, fire-stopping
- ELECTRICAL: Device boxes, panel locations, ceiling fixtures, access needs
- PLUMBING: Access panels, fixture rough-ins, pipe chases
- HVAC: Diffuser locations, access doors, duct penetrations, fire dampers

For each related division, identify:
✓ Backing and blocking requirements for drywall attachment
✓ Penetration and access requirements
✓ Fire rating coordination and assembly details
✓ Finish and trim interfaces
✓ Potential conflicts or risks

Provide actionable coordination items with risk indicators:
🔴 = Critical coordination required before bid
🟡 = Important coordination during construction
🟢 = Minor coordination item`,

  electrical: `Analyze coordination requirements for an ELECTRICAL contractor.

The electrical contractor needs to coordinate with:
- METALS: Support systems, cable tray, seismic bracing, grounding
- PLUMBING: Separation requirements, parallel runs, crossing conflicts
- HVAC: Control wiring, disconnect switches, equipment connections, power requirements
- FIRE ALARM: Integration points, monitoring, addressable devices
- COMMUNICATIONS: Pathways, equipment rooms, backbone cabling

For each related division, identify:
✓ Equipment locations and clearances required
✓ Conduit routing and potential conflicts
✓ Power requirements for other trades' equipment
✓ Control and monitoring integration needs
✓ Potential conflicts or risks

Provide actionable coordination items with risk indicators:
🔴 = Critical coordination required before bid
🟡 = Important coordination during construction
🟢 = Minor coordination item`,

  hvac: `Analyze coordination requirements for an HVAC contractor.

The HVAC contractor needs to coordinate with:
- STRUCTURAL: Roof/floor penetrations, equipment supports, load capacities, vibration
- PLUMBING: Drainage connections, condensate routing, pipe routing conflicts
- ELECTRICAL: Power connections, controls, disconnect switches, transformers
- FIRE PROTECTION: Duct smoke detectors, fire dampers, sprinkler coordination
- INSULATION: Duct insulation, pipe insulation specifications, vapor barriers

For each related division, identify:
✓ Equipment rough-in dimensions and clearances
✓ Clearance and access requirements for maintenance
✓ Utility connection details and sequencing
✓ Control and monitoring interfaces
✓ Potential conflicts or risks

Provide actionable coordination items with risk indicators:
🔴 = Critical coordination required before bid
🟡 = Important coordination during construction
🟢 = Minor coordination item`
};

// Export for use in Edge Functions
export {
  TRADE_DIVISION_MAP,
  COORDINATION_DIVISIONS,
  TRADE_PROMPTS,
  COORDINATION_PROMPTS
};

// ============================================================================
// USAGE EXAMPLES FOR EDGE FUNCTIONS
// ============================================================================

/*
// In analyze-trade Edge Function (supabase/functions/analyze-trade/index.ts):
// ----------------------------------------------------------------------------
import { TRADE_PROMPTS } from './trade-configurations.js';

const tradePrompt = TRADE_PROMPTS[trade] || TRADE_PROMPTS['masonry'];
const fullPrompt = `${tradePrompt}

Specification text:
${text}`;

// Send to Gemini API


// In analyze-coordination Edge Function (supabase/functions/analyze-coordination/index.ts):
// ---------------------------------------------------------------------------------------
import { COORDINATION_PROMPTS } from './trade-configurations.js';

const coordPrompt = COORDINATION_PROMPTS[trade] || COORDINATION_PROMPTS['masonry'];
const fullPrompt = `${coordPrompt}

Specification text from related divisions:
${coordinationText}`;

// Send to Gemini API


// In identify-critical-coordination Edge Function:
// ------------------------------------------------
import { COORDINATION_DIVISIONS } from './trade-configurations.js';

const expectedDivisions = COORDINATION_DIVISIONS[trade];
// Use expectedDivisions.primary, expectedDivisions.secondary, expectedDivisions.keywords
// to filter which divisions truly need coordination analysis

*/
