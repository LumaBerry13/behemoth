"""Mythic Bedrock converter (design doc §9).

Offline tool that turns a boss's Bedrock model/animation files and its
MythicMobs YAML into everything the Mythic Bedrock runtime needs:

* baked bone tracks + animation lengths (``generated/<boss>/*.js``)
* a patched behavior entity with the Mythic-ready stub (§5)
* a patched client entity + a base-layer (idle/walk) animation controller
* a boss config translated from the MythicMobs YAML (``bosses/private/<boss>.js``)
* a conversion report listing everything skipped or approximated
"""

__version__ = "0.1.0"
